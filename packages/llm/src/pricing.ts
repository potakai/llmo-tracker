import type { ProviderId } from './types'

/**
 * 料金表（USD）。値は公式の料金ページを 2026-11-21 に確認したもの。
 * - OpenAI gpt-5.4-mini: https://developers.openai.com/api/docs/models/gpt-5.4-mini
 *   https://developers.openai.com/api/docs/pricing
 *   Web 検索ツールは 1,000 回あたり $10。検索で読んだ内容のトークンは、入力のトークンとして課金される
 *   （API が返す入力のトークン数に含まれる）
 * - Gemini 3.8 Flash: https://aistudio.google.com/docs/pricing（旧 https://ai.google.dev/pricing）
 *   2026-12-31 までは入力 $0.75 / 出力 $3.75。2027-01-01 から入力 $1.50 / 出力 $7.50
 *   Google 検索のグラウンディングは「月 5,000 回の検索のリクエストまで無料（Gemini 3 以降のモデルで共有）、
 *   その後 1,000 回あたり $14」。脚注に「1 回のリクエストで検索が何回か走ることがあり、検索 1 回ごとに課金する」
 *   とあるので、無料枠はリクエストの数で数え、無料枠を超えたあとは検索の回数で計算する
 *
 * 料金は変わるので、表にないモデルの費用は null（不明）として扱う。
 */
type Price = {
  inputPerMTok: number
  outputPerMTok: number
  searchPer1k: number
  /** 月ごとの検索の無料枠（リクエストの数）。API キー（＝アプリ全体）で共有される */
  freeSearchRequestsPerMonth?: number
}

/** ある日（UTC の 0 時）から使う単価。`from` がないものは、最初から使う */
type PricePeriod = Price & { from?: string }

/** Gemini の Google 検索の無料枠（月あたりのリクエストの数） */
export const GEMINI_FREE_SEARCH_REQUESTS_PER_MONTH = 5_000

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
        freeSearchRequestsPerMonth: GEMINI_FREE_SEARCH_REQUESTS_PER_MONTH,
      },
      {
        from: '2027-01-01',
        inputPerMTok: 1.5,
        outputPerMTok: 7.5,
        searchPer1k: GEMINI_SEARCH_PER_1K,
        freeSearchRequestsPerMonth: GEMINI_FREE_SEARCH_REQUESTS_PER_MONTH,
      },
    ],
  },
}

type PriceKey = { provider: ProviderId; model: string; at: Date }

/**
 * モデル名の末尾の日付（スナップショット）。API は `gpt-5.4-mini-2026-03-17` のように日付付きの名前を返すことがある。
 * SQL（regexp_replace）でも同じパターンを使う
 */
export const MODEL_SNAPSHOT_SUFFIX_PATTERN = '-\\d{4}-\\d{2}-\\d{2}$'

/** 料金表を引くためのモデル名（末尾の日付を取り除く） */
export function pricingModelName(model: string): string {
  return model.replace(new RegExp(MODEL_SNAPSHOT_SUFFIX_PATTERN), '')
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
  return priceAt(key)?.freeSearchRequestsPerMonth !== undefined
}

/**
 * 検索の無料枠を共有するモデル（当月の利用回数を数える対象。日付なしの名前）。
 * 料金表にあるモデルだけなので、フェイクやデモのデータ（本物の API を使っていない）は入らない。
 * DB の model と比べるときは、末尾の日付を取り除いてから比べる（MODEL_SNAPSHOT_SUFFIX_PATTERN）
 */
export function modelsSharingFreeSearchTier(provider: ProviderId): string[] {
  return Object.entries(PRICING[provider])
    .filter(([, periods]) => periods.some((p) => p.freeSearchRequestsPerMonth !== undefined))
    .map(([model]) => model)
}

/**
 * 1 回の回答の費用の見積もり。料金表にないモデルや、トークン数が取れなかったときは null。
 * `searchRequestsUsedThisMonth`（このリクエストより前に、当月に使った検索のリクエストの数）を渡すと、
 * 無料枠に収まる分の検索を $0 にする。渡さないと無料枠を考えない（上限側の見積もり）。
 */
export function estimateCostUsd(input: {
  provider: ProviderId
  model: string
  inputTokens: number | null
  outputTokens: number | null
  searchCount: number
  /** 回答をもらった時刻（単価の切り替えに使う） */
  at: Date
  searchRequestsUsedThisMonth?: number
}): number | null {
  const price = priceAt(input)
  if (!price || input.inputTokens === null || input.outputTokens === null) return null
  const isSearchFree =
    price.freeSearchRequestsPerMonth !== undefined &&
    input.searchRequestsUsedThisMonth !== undefined &&
    input.searchRequestsUsedThisMonth < price.freeSearchRequestsPerMonth
  const billableSearches = isSearchFree ? 0 : input.searchCount
  const cost =
    (input.inputTokens / 1_000_000) * price.inputPerMTok +
    (input.outputTokens / 1_000_000) * price.outputPerMTok +
    (billableSearches / 1_000) * price.searchPer1k
  // DB の numeric(10,6) に合わせる
  return Math.round(cost * 1_000_000) / 1_000_000
}
