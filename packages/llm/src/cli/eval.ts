/**
 * 抽出の精度を測る。ゴールデンセット（eval/golden.json）を抽出器に流して採点し、表を出す。
 *   pnpm --filter @llmo/llm eval -- --extractor rule
 *   pnpm --filter @llmo/llm eval -- --extractor llm --only acct-prose   ← 本物の API を叩く（費用がかかる）
 * 使い方と指標の定義は eval/README.md。
 */

import { parseEvalArgs } from '../eval/args'
import { createEvalExtractor } from '../eval/extractors'
import { type GoldenCase, loadGoldenSet } from '../eval/golden'
import { formatReport, type ReportCase, type ReportUsage } from '../eval/report'
import { saveResult } from '../eval/results'
import { type CaseOutcome, runExtraction } from '../eval/run'
import { aggregateScores, scoreCase } from '../eval/score'
import type { UsageTracker } from '../eval/usage'
import { estimateCostUsd } from '../pricing'

const TIMEOUT_MS = 120_000

type Row = { c: GoldenCase; outcome: CaseOutcome }

function toReportCase({ c, outcome }: Row): ReportCase {
  return {
    id: c.id,
    note: c.note,
    expected: c.expected,
    // フォールバックしたときも、何を返したかは見えるようにする（採点は不正解として数える）
    actual: outcome.result,
    score: scoreCase(c.expected, outcome.error ? null : outcome.result),
    error: outcome.error,
  }
}

function summarizeUsage(usage: UsageTracker | null, modelId: string): ReportUsage | null {
  if (!usage) return null
  const totals = usage.totals()
  const costUsd = estimateCostUsd({
    provider: 'openai',
    model: modelId,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    searchCount: 0,
  })
  return { ...totals, costUsd }
}

async function main(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2))
  const { extractor, modelId, usage } = createEvalExtractor(args.extractor, process.env)

  const allCases = await loadGoldenSet()
  const cases = args.only ? allCases.filter((c) => c.id === args.only) : allCases
  if (cases.length === 0) throw new Error(`id「${args.only}」のケースはありません`)

  const startedAt = new Date()
  console.error(`→ ${cases.length} 件を ${args.extractor}（${modelId}）で抽出しています...`)
  const outcomes = await runExtraction(cases, extractor, {
    concurrency: args.concurrency,
    timeoutMs: TIMEOUT_MS,
  })

  const rows: Row[] = cases.flatMap((c, i) => {
    const outcome = outcomes[i]
    return outcome ? [{ c, outcome }] : []
  })
  const reportCases = rows.map(toReportCase)
  const metrics = aggregateScores(reportCases.map((c) => c.score))
  const reportUsage = summarizeUsage(usage, modelId)
  console.log(
    formatReport({
      extractor: args.extractor,
      modelId,
      metrics,
      cases: reportCases,
      usage: reportUsage,
    }),
  )

  const path = await saveResult(
    {
      extractor: args.extractor,
      modelId,
      startedAt: startedAt.toISOString(),
      only: args.only,
      metrics,
      usage: reportUsage,
      cases: rows.map((row) => {
        const { actual: _actual, ...reported } = toReportCase(row)
        return { ...reported, result: row.outcome.result, durationMs: row.outcome.durationMs }
      }),
    },
    startedAt,
  )
  console.error(`\n詳細: ${path}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
