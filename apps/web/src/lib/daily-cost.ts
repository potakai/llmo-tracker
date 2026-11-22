import type { ProviderKey } from '@/components/labels'

type CostByProvider = Record<ProviderKey, number | null>

/** AI ごとの 1 回答あたりの費用の目安（サーバーの perAnswerCosts が作る） */
export type AnswerCosts = {
  /** ふだんの額（検索の無料枠に収まっている前提） */
  perAnswerUsd: CostByProvider
  /** 検索の無料枠を使い切ったあとの額 */
  beyondFreeSearchesUsd: CostByProvider
  /** 検索の無料枠（月あたりの検索の回数）。注記に出す */
  freeSearchesPerMonth: number
}

/**
 * 毎朝の計測 1 回あたりの費用の目安（USD）。
 * 聞く回数 × 質問数 × 計測する AI ごとの「1 回答あたりの目安」の合計。
 * 目安がわからない AI（料金表にないモデル）が入っていたら null（少なく見せない）。
 * 画面で入力に合わせて計算し直すので、サーバーの処理には頼らない
 */
export function estimateDailyRunCostUsd(input: {
  samplesPerPrompt: number
  promptCount: number
  providers: readonly ProviderKey[]
  perAnswerUsd: CostByProvider
}): number | null {
  let perPromptSample = 0
  for (const provider of input.providers) {
    const perAnswer = input.perAnswerUsd[provider]
    if (perAnswer === null) return null
    perPromptSample += perAnswer
  }
  return input.samplesPerPrompt * input.promptCount * perPromptSample
}

export type DailyRunCostRange = {
  /** 検索の無料枠（Gemini）が残っている場合の、毎朝の計測 1 回あたりの額 */
  withinFreeSearches: number | null
  /** 検索の無料枠を使い切った場合の額 */
  beyondFreeSearches: number | null
  /** 無料枠が残っているかどうかで額が変わるか（無料枠のある AI を計測するか） */
  dependsOnFreeSearches: boolean
}

/**
 * 毎朝の計測 1 回あたりの額を、検索の無料枠が残っている場合と使い切った場合の両方で出す。
 * 無料枠はアプリ全体（すべてのブランド）で共有しているので、どちらになるかはほかのブランドの計測にもよる
 */
export function estimateDailyRunCostRange(input: {
  samplesPerPrompt: number
  promptCount: number
  providers: readonly ProviderKey[]
  costs: AnswerCosts
}): DailyRunCostRange {
  const { costs, ...run } = input
  const withinFreeSearches = estimateDailyRunCostUsd({ ...run, perAnswerUsd: costs.perAnswerUsd })
  const beyondFreeSearches = estimateDailyRunCostUsd({
    ...run,
    perAnswerUsd: costs.beyondFreeSearchesUsd,
  })
  const dependsOnFreeSearches = input.providers.some(
    (p) => costs.perAnswerUsd[p] !== costs.beyondFreeSearchesUsd[p],
  )
  return { withinFreeSearches, beyondFreeSearches, dependsOnFreeSearches }
}

/** 費用の表示。1 ドル未満は細かい額まで見えるように 3 桁 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}
