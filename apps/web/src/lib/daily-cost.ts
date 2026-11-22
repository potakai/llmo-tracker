import type { ProviderKey } from '@/components/labels'

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
  perAnswerUsd: Record<ProviderKey, number | null>
}): number | null {
  let perPromptSample = 0
  for (const provider of input.providers) {
    const perAnswer = input.perAnswerUsd[provider]
    if (perAnswer === null) return null
    perPromptSample += perAnswer
  }
  return input.samplesPerPrompt * input.promptCount * perPromptSample
}

/** 費用の表示。1 ドル未満は細かい額まで見えるように 3 桁 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}
