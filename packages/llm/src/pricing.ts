import type { ProviderId } from './types'

/**
 * 料金表（USD）。値は公式の料金ページを 2026-11-21 に確認したもの。
 * - OpenAI gpt-5.4-mini: https://developers.openai.com/api/docs/models/gpt-5.4-mini
 *   https://developers.openai.com/api/docs/pricing
 *   Web 検索ツールは 1,000 回あたり $10。検索で読んだ内容のトークンは、入力のトークンとして課金される
 *   （API が返す入力のトークン数に含まれる）
 * - Gemini 3.8 Flash: https://aistudio.google.com/docs/pricing（旧 https://ai.google.dev/pricing）
 *   2026-12-31 までは入力 $0.75 / 出力 $3.75。2027-01-01 から入力 $1.50 / 出力 $7.50
 *   Google 検索のグラウンディングは「月 5,000 回まで無料（Gemini 3 以降のモデルで共有）、その後 1,000 回あたり $14」。
 *   本文は「requests」だが、脚注に「1 回のリクエストで検索が何回か走ることがあり、検索 1 回ごとに課金する」とあるので、
 *   無料枠も課金も検索の回数（webSearchQueries の数）で数える
 *
 * Gemini の検索の無料枠の見積もりの、既知の制限：
 * - 無料枠は API キー（＝アプリ全体）で共有されるので、当月のアプリ全体の検索の回数を DB から数えて渡す
 *   （packages/runner の countSearchesThisMonth）
 * - 同時に保存される回答どうしは互いを数えないので、最後の無料枠を 2 件で使い合うことがある。
 *   費用の目安なので直さない（ずれるのは無料枠の境目の数セントだけ）
 * - Google の請求の月の区切り（タイムゾーン）は料金ページに書かれていないので、UTC で区切る
 *
 * 料金は変わるので、表にないモデルの費用は null（不明）として扱う。
 */
type Price = {
  inputPerMTok: number
  outputPerMTok: number
  searchPer1k: number
  /** 月ごとの検索の無料枠（検索の回数）。API キー（＝アプリ全体）で共有される */
  freeSearchesPerMonth?: number
}

/** ある日（UTC の 0 時）から使う単価。`from` がないものは、最初から使う */
type PricePeriod = Price & { from?: string }

/** Gemini の Google 検索の無料枠（月あたりの検索の回数） */
export const GEMINI_FREE_SEARCHES_PER_MONTH = 5_000

const GEMINI_SEARCH_PER_1K = 14

/** モデルごとの単価。期間は古い順に並べる */
const PRICING: Record<ProviderId, Record<string, readonly PricePeriod[]>> = {
  openai: {
    'gpt-5.4-mini': [{ inputPerMTok: 0.75, outputPerMTok: 4.5, searchPer1k: 10 }],
  },
  gemini: {
    'gemini-3.8-flash': [
      {
        inputPerMTok: 0.75,
        outputPerMTok: 3.75,
        searchPer1k: GEMINI_SEARCH_PER_1K,
        freeSearchesPerMonth: GEMINI_FREE_SEARCHES_PER_MONTH,
      },
      {
        from: '2027-01-01',
        inputPerMTok: 1.5,
        outputPerMTok: 7.5,
        searchPer1k: GEMINI_SEARCH_PER_1K,
        freeSearchesPerMonth: GEMINI_FREE_SEARCHES_PER_MONTH,
      },
    ],
  },
}

type PriceKey = { provider: ProviderId; model: string; at: Date }

/** モデル名の末尾の日付（スナップショット）。API は `gpt-5.4-mini-2026-03-17` のように日付付きの名前を返すことがある */
const MODEL_SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/

/** 料金表を引くためのモデル名（末尾の日付を取り除く） */
export function pricingModelName(model: string): string {
  return model.replace(MODEL_SNAPSHOT_SUFFIX, '')
}

/** その時点の単価。料金表にないモデルは null */
function priceAt({ provider, model, at }: PriceKey): Price | null {
  const periods = PRICING[provider][pricingModelName(model)] ?? []
  const current = periods.filter(
    (p) => p.from === undefined || new Date(`${p.from}T00:00:00Z`) <= at,
  )
  return current.at(-1) ?? null
}

/** 検索の無料枠があるモデルか（あれば、当月の利用回数を数えて estimateCostUsd に渡す） */
export function hasFreeSearchTier(key: PriceKey): boolean {
  return priceAt(key)?.freeSearchesPerMonth !== undefined
}

/**
 * 1 回の回答の費用の見積もり。料金表にないモデルや、トークン数が取れなかったときは null。
 * `searchesUsedThisMonth`（この回答より前に、当月にアプリ全体で使った検索の回数）を渡すと、
 * 残りの無料枠に収まる分の検索を $0 にし、超えた分だけ課金する。渡さないと無料枠を考えない（上限側の見積もり）。
 */
export function estimateCostUsd(input: {
  provider: ProviderId
  model: string
  inputTokens: number | null
  outputTokens: number | null
  searchCount: number
  /** 回答をもらった時刻（単価の切り替えに使う） */
  at: Date
  searchesUsedThisMonth?: number
}): number | null {
  const price = priceAt(input)
  if (!price || input.inputTokens === null || input.outputTokens === null) return null
  const billableSearches = billableSearchCount(
    input.searchCount,
    price.freeSearchesPerMonth,
    input.searchesUsedThisMonth,
  )
  const cost =
    (input.inputTokens / 1_000_000) * price.inputPerMTok +
    (input.outputTokens / 1_000_000) * price.outputPerMTok +
    (billableSearches / 1_000) * price.searchPer1k
  // DB の numeric(10,6) に合わせる
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** 課金される検索の回数。残りの無料枠を超えた分だけ（残り 1 回で 3 回検索したら 2 回） */
function billableSearchCount(
  searchCount: number,
  freePerMonth: number | undefined,
  usedThisMonth: number | undefined,
): number {
  if (freePerMonth === undefined || usedThisMonth === undefined) return searchCount
  const freeLeft = Math.max(0, freePerMonth - usedThisMonth)
  return Math.max(0, searchCount - freeLeft)
}
