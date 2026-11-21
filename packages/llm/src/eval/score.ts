/**
 * 抽出の採点。ゴールデンセットの正解と抽出結果を比べる純粋な関数だけを置く。
 * 指標の定義は packages/llm/eval/README.md を参照。
 */
import { normalize } from '../extract/rule-based'
import type { ExtractionResult } from '../extract/types'
import type { ExpectedExtraction } from './golden'

export type ActualExtraction = Pick<
  ExtractionResult,
  'brandMentioned' | 'brandRank' | 'sentiment' | 'mentions'
>

type Mention = {
  entityType: 'brand' | 'competitor' | 'unknown'
  competitorId: string | null
  name: string
}

/** 正解と抽出結果の、会社の集合の比べ方 */
export type SetComparison = {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  /** 正解にあって抽出結果にない（登録済みは brand / competitor:<id>、未登録は normalize した名前） */
  missing: string[]
  /** 抽出結果にあって正解にない */
  extra: string[]
}

export type CaseScore = {
  brandMentioned: boolean
  brandRank: boolean
  /** 正解でブランドが出てこないケースは対象外（null） */
  sentiment: boolean | null
  /** 抽出器が sentiment を返したか（null 以外）。1件も返さない抽出器は、感情の正解率を対象外にする */
  sentimentReturned: boolean
  registered: SetComparison
  /** 両方に出てくる登録済みの会社が1つ以下なら対象外（null） */
  order: boolean | null
  /** 参考値。ケースの正解・不正解には使わない */
  unknown: SetComparison
  /** 未登録の会社以外の判定がすべて正解 */
  passed: boolean
}

export type Ratio = { correct: number; total: number; rate: number | null }

export type PrecisionRecall = {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number | null
  recall: number | null
  f1: number | null
}

export type EvalMetrics = {
  caseCount: number
  passedCount: number
  brandMentionAccuracy: Ratio
  brandRankAccuracy: Ratio
  /** 抽出器が sentiment を一度も返さなかったときは null（対象外。0% とは区別する） */
  sentimentAccuracy: Ratio | null
  registered: PrecisionRecall
  orderAccuracy: Ratio
  unknown: PrecisionRecall
}

/** 登録済みの会社は competitorId で照合する（表記は問わない） */
function registeredKeys(mentions: readonly Mention[]): string[] {
  const keys = mentions.flatMap((m) => {
    if (m.entityType === 'brand') return ['brand']
    if (m.entityType === 'competitor') return [`competitor:${m.competitorId}`]
    return []
  })
  return [...new Set(keys)]
}

/** 未登録の会社は normalize した名前で照合する */
function unknownKeys(mentions: readonly Mention[]): string[] {
  const keys = mentions.filter((m) => m.entityType === 'unknown').map((m) => normalize(m.name))
  return [...new Set(keys.filter((k) => k !== ''))]
}

function compareSets(expected: readonly string[], actual: readonly string[]): SetComparison {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const missing = expected.filter((k) => !actualSet.has(k))
  const extra = actual.filter((k) => !expectedSet.has(k))
  return {
    truePositives: expected.length - missing.length,
    falsePositives: extra.length,
    falseNegatives: missing.length,
    missing,
    extra,
  }
}

const MIN_COMMON_FOR_ORDER = 2

/** 両方に出てくる会社だけを取り出して、並び順が同じかを比べる */
function compareOrder(expected: readonly string[], actual: readonly string[]): boolean | null {
  const common = expected.filter((k) => actual.includes(k))
  if (common.length < MIN_COMMON_FOR_ORDER) return null
  const actualOrder = actual.filter((k) => common.includes(k))
  return common.every((k, i) => actualOrder[i] === k)
}

/** 抽出に失敗したケース。すべての判定を不正解として数える */
function scoreFailure(expected: ExpectedExtraction): CaseScore {
  const registered = registeredKeys(expected.mentions)
  return {
    brandMentioned: false,
    brandRank: false,
    sentiment: expected.brandMentioned ? false : null,
    sentimentReturned: false,
    registered: compareSets(registered, []),
    order: registered.length >= MIN_COMMON_FOR_ORDER ? false : null,
    unknown: compareSets(unknownKeys(expected.mentions), []),
    passed: false,
  }
}

/** 1件の採点。actual が null なら抽出に失敗したとみなす */
export function scoreCase(
  expected: ExpectedExtraction,
  actual: ActualExtraction | null,
): CaseScore {
  if (actual === null) return scoreFailure(expected)

  const expectedRegistered = registeredKeys(expected.mentions)
  const actualRegistered = registeredKeys(actual.mentions)
  const registered = compareSets(expectedRegistered, actualRegistered)
  const score = {
    brandMentioned: expected.brandMentioned === actual.brandMentioned,
    brandRank: expected.brandRank === actual.brandRank,
    sentiment: expected.brandMentioned ? expected.sentiment === actual.sentiment : null,
    sentimentReturned: actual.sentiment !== null,
    registered,
    order: compareOrder(expectedRegistered, actualRegistered),
    unknown: compareSets(unknownKeys(expected.mentions), unknownKeys(actual.mentions)),
  }
  const passed =
    score.brandMentioned &&
    score.brandRank &&
    score.sentiment !== false &&
    registered.falsePositives === 0 &&
    registered.falseNegatives === 0 &&
    score.order !== false
  return { ...score, passed }
}

function ratio(values: readonly (boolean | null)[]): Ratio {
  const targets = values.filter((v): v is boolean => v !== null)
  const correct = targets.filter((v) => v).length
  return {
    correct,
    total: targets.length,
    rate: targets.length > 0 ? correct / targets.length : null,
  }
}

function precisionRecall(comparisons: readonly SetComparison[]): PrecisionRecall {
  const sum = (pick: (c: SetComparison) => number) =>
    comparisons.reduce((acc, c) => acc + pick(c), 0)
  const truePositives = sum((c) => c.truePositives)
  const falsePositives = sum((c) => c.falsePositives)
  const falseNegatives = sum((c) => c.falseNegatives)
  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null
  return { truePositives, falsePositives, falseNegatives, precision, recall, f1 }
}

/** 全体の集計。適合率・再現率は全ケースの件数を合計してから計算する（マイクロ平均） */
export function aggregateScores(scores: readonly CaseScore[]): EvalMetrics {
  return {
    caseCount: scores.length,
    passedCount: scores.filter((s) => s.passed).length,
    brandMentionAccuracy: ratio(scores.map((s) => s.brandMentioned)),
    brandRankAccuracy: ratio(scores.map((s) => s.brandRank)),
    sentimentAccuracy: scores.some((s) => s.sentimentReturned)
      ? ratio(scores.map((s) => s.sentiment))
      : null,
    registered: precisionRecall(scores.map((s) => s.registered)),
    orderAccuracy: ratio(scores.map((s) => s.order)),
    unknown: precisionRecall(scores.map((s) => s.unknown)),
  }
}
