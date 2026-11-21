import { type LanguageModel, wrapLanguageModel } from 'ai'

export type UsageTotals = { calls: number; inputTokens: number; outputTokens: number }

export type UsageTracker = {
  /** トークン数を数えるように包んだモデル。抽出器にはこちらを渡す */
  model: LanguageModel
  totals(): UsageTotals
}

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]['model']

/** モデルを呼ぶたびに使ったトークン数を足し上げる（抽出器そのものには手を入れない） */
export function createUsageTracker(model: WrappableModel): UsageTracker {
  let totals: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 }
  const wrapped = wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      async wrapGenerate({ doGenerate }) {
        const result = await doGenerate()
        totals = {
          calls: totals.calls + 1,
          inputTokens: totals.inputTokens + (result.usage.inputTokens.total ?? 0),
          outputTokens: totals.outputTokens + (result.usage.outputTokens.total ?? 0),
        }
        return result
      },
    },
  })
  return { model: wrapped, totals: () => totals }
}
