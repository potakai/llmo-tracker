/**
 * 抽出の精度を測る。ゴールデンセット（eval/golden.json）を抽出器に流して採点し、表を出す。
 *   pnpm --filter @llmo/llm eval -- --extractor rule
 *   pnpm --filter @llmo/llm eval -- --extractor llm --only acct-prose   ← 本物の API を叩く（費用がかかる）
 *   pnpm --filter @llmo/llm eval -- --extractor llm --replay eval/results/<file>.json   ← API は呼ばない
 * 使い方と指標の定義は eval/README.md。
 */

import { resolve } from 'node:path'
import { type EvalArgs, parseEvalArgs } from '../eval/args'
import { createEvalExtractor } from '../eval/extractors'
import { type GoldenCase, loadGoldenSet } from '../eval/golden'
import { loadReplaySource, replayOutcomes } from '../eval/replay'
import { formatReport, type ReportCase, type ReportUsage } from '../eval/report'
import { saveResult } from '../eval/results'
import { type CaseOutcome, runExtraction } from '../eval/run'
import {
  aggregateScores,
  type CaseScore,
  type EvalMetrics,
  type ScoreOptions,
  scoreCase,
  scoreCases,
} from '../eval/score'
import type { UsageTracker } from '../eval/usage'
import { estimateCostUsd } from '../pricing'

const TIMEOUT_MS = 120_000

type Row = { c: GoldenCase; outcome: CaseOutcome }

function toReportCase({ c, outcome }: Row, score: CaseScore): ReportCase {
  return {
    id: c.id,
    note: c.note,
    expected: c.expected,
    // フォールバックしたときも、何を返したかは見えるようにする（採点は不正解として数える）
    actual: outcome.result,
    score,
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
    at: new Date(),
  })
  return { ...totals, costUsd }
}

type Extracted = {
  /** レポートと結果ファイルに書く抽出器の名前（replay なら llm-replay） */
  label: string
  modelId: string
  outcomes: CaseOutcome[]
  usage: ReportUsage | null
  scoreOptions: ScoreOptions
}

/** 保存済みの LLM の出力に、現在の突き合わせをかけ直す（API は呼ばない） */
async function replay(path: string, cases: readonly GoldenCase[]): Promise<Extracted> {
  const source = await loadReplaySource(path)
  console.error(
    `→ ${cases.length} 件を ${path} の LLM の出力で replay しています（API は呼ばない）...`,
  )
  return {
    label: 'llm-replay',
    modelId: source.modelId,
    outcomes: replayOutcomes(cases, source),
    usage: null,
    // LLM は感情を返す仕様
    scoreOptions: { scoreSentiment: true },
  }
}

async function extract(args: EvalArgs, cases: readonly GoldenCase[]): Promise<Extracted> {
  // pnpm --filter は packages/llm で動くので、相対パスは呼び出した場所（INIT_CWD）から解決する
  if (args.replay) return replay(resolve(process.env.INIT_CWD ?? '.', args.replay), cases)
  const { extractor, modelId, usage, scoreOptions } = createEvalExtractor(
    args.extractor,
    process.env,
  )
  console.error(`→ ${cases.length} 件を ${args.extractor}（${modelId}）で抽出しています...`)
  const outcomes = await runExtraction(cases, extractor, {
    concurrency: args.concurrency,
    timeoutMs: TIMEOUT_MS,
  })
  return {
    label: args.extractor,
    modelId,
    outcomes,
    usage: summarizeUsage(usage, modelId),
    scoreOptions,
  }
}

/** ケースごとに採点し、全体を集計する */
function scoreRows(
  cases: readonly GoldenCase[],
  outcomes: readonly CaseOutcome[],
  scoreOptions: ScoreOptions,
): { rows: Row[]; reportCases: ReportCase[]; metrics: EvalMetrics } {
  const rows: Row[] = cases.flatMap((c, i) => {
    const outcome = outcomes[i]
    return outcome ? [{ c, outcome }] : []
  })
  // 感情を採点するかは抽出器の仕様で決める（rule は採点しない、llm は採点する）
  const scores = scoreCases(
    rows.map(({ c, outcome }) => ({
      expected: c.expected,
      actual: outcome.error ? null : outcome.result,
    })),
    scoreOptions,
  )
  const reportCases = rows.map((row, i) =>
    toReportCase(row, scores[i] ?? scoreCase(row.c.expected, null, scoreOptions)),
  )
  const metrics = aggregateScores(
    reportCases.map((c) => c.score),
    scoreOptions,
  )
  return { rows, reportCases, metrics }
}

async function main(): Promise<void> {
  const args = parseEvalArgs(process.argv.slice(2))
  const allCases = await loadGoldenSet()
  const cases = args.only ? allCases.filter((c) => c.id === args.only) : allCases
  if (cases.length === 0) throw new Error(`id「${args.only}」のケースはありません`)

  const startedAt = new Date()
  const { label, modelId, outcomes, usage: reportUsage, scoreOptions } = await extract(args, cases)

  const { rows, reportCases, metrics } = scoreRows(cases, outcomes, scoreOptions)
  console.log(
    formatReport({
      extractor: label,
      modelId,
      metrics,
      cases: reportCases,
      usage: reportUsage,
    }),
  )

  const path = await saveResult(
    {
      extractor: label,
      modelId,
      startedAt: startedAt.toISOString(),
      only: args.only,
      metrics,
      usage: reportUsage,
      cases: reportCases.map(({ actual: _actual, ...reported }, i) => ({
        ...reported,
        result: rows[i]?.outcome.result ?? null,
        durationMs: rows[i]?.outcome.durationMs ?? 0,
      })),
    },
    startedAt,
  )
  console.error(`\n詳細: ${path}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
