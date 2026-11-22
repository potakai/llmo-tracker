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

export type FreeSearchTierNote = {
  provider: ProviderKey
  /** 無料枠を超えたときの 1 回答あたりの額 */
  perAnswerUsd: number
  /** その AI だけ無料枠を超えたときの、毎朝の計測 1 回あたりの額 */
  dailyUsd: number | null
}

/**
 * 検索の無料枠を超えると高くなる AI（Gemini）ごとの注記。
 * ふだんの目安は無料枠に収まる前提なので、超えたらいくらになるかを並べて見せる
 */
export function freeSearchTierNotes(input: {
  samplesPerPrompt: number
  promptCount: number
  providers: readonly ProviderKey[]
  costs: AnswerCosts
}): FreeSearchTierNote[] {
  const { costs } = input
  return input.providers.flatMap((provider) => {
    const usual = costs.perAnswerUsd[provider]
    const beyond = costs.beyondFreeSearchesUsd[provider]
    if (usual === null || beyond === null || beyond <= usual) return []
    const dailyUsd = estimateDailyRunCostUsd({
      ...input,
      perAnswerUsd: { ...costs.perAnswerUsd, [provider]: beyond },
    })
    return [{ provider, perAnswerUsd: beyond, dailyUsd }]
  })
}

/** 費用の表示。1 ドル未満は細かい額まで見えるように 3 桁 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}
