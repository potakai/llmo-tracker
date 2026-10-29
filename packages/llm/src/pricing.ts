import type { ProviderId } from './types'

/**
 * 料金表（USD）。値は公式の料金ページを 2026-10-29 に確認したもの。
 * - OpenAI gpt-5.4-mini: https://developers.openai.com/api/docs/models/gpt-5.4-mini
 *   Web 検索ツールは 1,000 回あたり $10（2026-03-30 に $25 から値下げ）
 * - Gemini 3.8 Flash: https://ai.google.dev/pricing
 *   2026-12-31 までの価格。2027-01-01 から入力 $1.50 / 出力 $7.50 に上がる
 *   Google 検索のグラウンディングは月 5,000 回まで無料、その後 1,000 回あたり $14
 *   （無料枠はここでは考えず、上限側の見積もりにしている）
 *
 * 料金は変わるので、表にないモデルの費用は null（不明）として扱う。
 */
type Price = {
  inputPerMTok: number
  outputPerMTok: number
  searchPer1k: number
}

const PRICING: Record<ProviderId, Record<string, Price>> = {
  openai: {
    'gpt-5.4-mini': { inputPerMTok: 0.75, outputPerMTok: 4.5, searchPer1k: 10 },
  },
  gemini: {
    'gemini-3.8-flash': { inputPerMTok: 0.75, outputPerMTok: 3.75, searchPer1k: 14 },
  },
}

/** 1 回の回答の費用の見積もり。料金表にないモデルや、トークン数が取れなかったときは null */
export function estimateCostUsd(input: {
  provider: ProviderId
  model: string
  inputTokens: number | null
  outputTokens: number | null
  searchCount: number
}): number | null {
  const price = PRICING[input.provider][input.model]
  if (!price || input.inputTokens === null || input.outputTokens === null) return null
  const cost =
    (input.inputTokens / 1_000_000) * price.inputPerMTok +
    (input.outputTokens / 1_000_000) * price.outputPerMTok +
    (input.searchCount / 1_000) * price.searchPer1k
  // DB の numeric(10,6) に合わせる
  return Math.round(cost * 1_000_000) / 1_000_000
}
