import { describe, expect, it } from 'vitest'
import { estimateCostUsd } from '../src'

describe('estimateCostUsd', () => {
  it('トークン数と検索回数から費用を出す', () => {
    // 入力 1,000 × $0.75/M + 出力 2,000 × $4.50/M + 検索 1 回 × $10/1k
    const cost = estimateCostUsd({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      inputTokens: 1_000,
      outputTokens: 2_000,
      searchCount: 1,
    })
    expect(cost).toBeCloseTo(0.00075 + 0.009 + 0.01, 6)
  })

  it('料金表にないモデルや、トークン数が取れないときは null', () => {
    const base = { provider: 'openai' as const, inputTokens: 1, outputTokens: 1, searchCount: 0 }
    expect(estimateCostUsd({ ...base, model: 'unknown-model' })).toBeNull()
    expect(estimateCostUsd({ ...base, model: 'gpt-5.4-mini', inputTokens: null })).toBeNull()
  })
})
