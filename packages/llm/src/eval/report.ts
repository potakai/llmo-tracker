/** 評価結果を標準出力用の文字列にする（Markdown の表にして、PR にそのまま貼れるようにする） */

import type { ExpectedExtraction } from './golden'
import type { ActualExtraction, CaseScore, EvalMetrics, PrecisionRecall, Ratio } from './score'
import type { UsageTotals } from './usage'

export type ReportCase = {
  id: string
  note: string
  expected: ExpectedExtraction
  actual: ActualExtraction | null
  score: CaseScore
  error: string | null
}

export type ReportUsage = UsageTotals & { costUsd: number | null }

export type ReportInput = {
  extractor: string
  modelId: string
  metrics: EvalMetrics
  cases: readonly ReportCase[]
  usage: ReportUsage | null
}

const percent = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`

const ratioRow = (label: string, r: Ratio): string =>
  `| ${label} | ${percent(r.rate)} | ${r.correct} / ${r.total} |`

function precisionRows(label: string, pr: PrecisionRecall, withF1: boolean): string[] {
  const counts = `TP ${pr.truePositives} / FP ${pr.falsePositives} / FN ${pr.falseNegatives}`
  return [
    `| ${label}の適合率 | ${percent(pr.precision)} | ${counts} |`,
    `| ${label}の再現率 | ${percent(pr.recall)} | ${counts} |`,
    ...(withF1 ? [`| ${label}の F1 | ${percent(pr.f1)} | |`] : []),
  ]
}

const SENTIMENT_EXCLUDED_NOTE =
  '※ 抽出器が感情を返さないので、全問正解の判定に感情を含めていない（感情の正解率も対象外）'

function formatMetrics(m: EvalMetrics): string {
  const rows = [
    '| 指標 | 値 | 内訳 |',
    '|---|---|---|',
    `| 全問正解のケース | ${percent(m.caseCount > 0 ? m.passedCount / m.caseCount : null)} | ${m.passedCount} / ${m.caseCount} |`,
    ratioRow('ブランド言及の正解率', m.brandMentionAccuracy),
    ratioRow('ブランド順位の正解率', m.brandRankAccuracy),
    m.sentimentAccuracy
      ? ratioRow('感情の正解率', m.sentimentAccuracy)
      : '| 感情の正解率 | — | 対象外（抽出器が感情を返さない） |',
    ...precisionRows('登録済みの会社', m.registered, true),
    ratioRow('登録済みの会社の順序一致率', m.orderAccuracy),
    ...precisionRows('未登録の会社（参考）', m.unknown, false),
  ].join('\n')
  return m.sentimentAccuracy === null ? `${rows}\n\n${SENTIMENT_EXCLUDED_NOTE}` : rows
}

type Mention = ExpectedExtraction['mentions'][number]

function mentionLabel(m: Mention): string {
  if (m.entityType === 'brand') return `${m.name}[ブランド]`
  if (m.entityType === 'competitor') return `${m.name}[${m.competitorId}]`
  return `${m.name}[未登録]`
}

function describeExtraction(e: {
  brandRank: number | null
  sentiment: string | null
  mentions: readonly Mention[]
}): string {
  const mentions = e.mentions.length > 0 ? e.mentions.map(mentionLabel).join(' → ') : '（なし）'
  const rank = e.brandRank === null ? 'なし' : `${e.brandRank}位`
  return `${mentions}　／ ブランド: ${rank}、感情: ${e.sentiment ?? '—'}`
}

/** どの判定が外れたかを短く書く */
function failedChecks(c: ReportCase): string[] {
  const { score } = c
  const registered = [
    ...score.registered.missing.map((k) => `取りこぼし ${k}`),
    ...score.registered.extra.map((k) => `余計 ${k}`),
  ]
  return [
    ...(score.brandMentioned ? [] : ['ブランド言及']),
    ...(score.brandRank ? [] : ['ブランド順位']),
    ...(score.sentiment === false ? ['感情'] : []),
    ...(registered.length > 0 ? [`登録済みの会社（${registered.join('、')}）`] : []),
    ...(score.order === false ? ['順序'] : []),
  ]
}

function formatFailure(c: ReportCase): string {
  const unknown = [
    ...c.score.unknown.missing.map((k) => `取りこぼし ${k}`),
    ...c.score.unknown.extra.map((k) => `余計 ${k}`),
  ]
  return [
    `■ ${c.id} — ${c.note}`,
    `  外れた判定: ${failedChecks(c).join('、')}`,
    ...(c.error ? [`  抽出エラー: ${c.error}`] : []),
    `  正解    : ${describeExtraction(c.expected)}`,
    `  抽出結果: ${c.actual ? describeExtraction(c.actual) : '（なし）'}`,
    ...(unknown.length > 0 ? [`  未登録の会社（参考）: ${unknown.join('、')}`] : []),
  ].join('\n')
}

function formatUsage(u: ReportUsage): string {
  const cost = u.costUsd === null ? '不明（料金表にないモデル）' : `$${u.costUsd.toFixed(4)}`
  return `LLM の使用量: ${u.calls} 回 / 入力 ${u.inputTokens.toLocaleString()} トークン / 出力 ${u.outputTokens.toLocaleString()} トークン / 推定費用 ${cost}`
}

/** 感情だけが外れたケース（感情を返さないルールベースでは大半がこれになるので、1行にまとめる） */
function isSentimentOnlyFailure(c: ReportCase): boolean {
  const checks = failedChecks(c)
  return c.error === null && checks.length === 1 && checks[0] === '感情'
}

function formatFailures(failures: readonly ReportCase[]): string[] {
  if (failures.length === 0) return ['（なし）']
  const sentimentOnly = failures.filter(isSentimentOnlyFailure)
  const others = failures.filter((c) => !isSentimentOnlyFailure(c))
  return [
    ...others.map((c) => `${formatFailure(c)}\n`),
    ...(sentimentOnly.length > 0
      ? [
          `感情だけが外れたケース（${sentimentOnly.length} 件）: ${sentimentOnly.map((c) => c.id).join(', ')}`,
        ]
      : []),
  ]
}

export function formatReport(input: ReportInput): string {
  const failures = input.cases.filter((c) => !c.score.passed)
  return [
    `## 抽出の評価：${input.extractor}（${input.modelId}）`,
    '',
    formatMetrics(input.metrics),
    '',
    ...(input.usage ? [formatUsage(input.usage), ''] : []),
    `### 外れたケース（${failures.length} 件）`,
    '',
    ...formatFailures(failures),
  ].join('\n')
}
