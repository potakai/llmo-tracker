import { describe, expect, it } from 'vitest'
import {
  estimateCostUsd,
  GEMINI_FREE_SEARCHES_PER_MONTH,
  hasFreeSearchTier,
  typicalAnswerCostUsd,
} from '../src'

const NOV_2026 = new Date('2026-11-21T00:00:00Z')

describe('estimateCostUsd', () => {
  it('トークン数と検索回数から費用を出す', () => {
    // 入力 1,000 × $0.75/M + 出力 2,000 × $4.50/M + 検索 1 回 × $10/1k
    const cost = estimateCostUsd({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      inputTokens: 1_000,
      outputTokens: 2_000,
      searchCount: 1,
      at: NOV_2026,
    })
    expect(cost).toBeCloseTo(0.00075 + 0.009 + 0.01, 6)
  })

  it('モデル名の末尾に日付（-YYYY-MM-DD）が付いていても、日付なしのモデルの単価で計算する', () => {
    const cost = estimateCostUsd({
      provider: 'openai',
      model: 'gpt-5.4-mini-2026-03-17',
      inputTokens: 1_000,
      outputTokens: 2_000,
      searchCount: 1,
      at: NOV_2026,
    })
    expect(cost).toBeCloseTo(0.00075 + 0.009 + 0.01, 6)
  })

  it('料金表にないモデルや、トークン数が取れないときは null', () => {
    const base = {
      provider: 'openai' as const,
      inputTokens: 1,
      outputTokens: 1,
      searchCount: 0,
      at: NOV_2026,
    }
    expect(estimateCostUsd({ ...base, model: 'unknown-model' })).toBeNull()
    expect(estimateCostUsd({ ...base, model: 'gpt-5.4-mini', inputTokens: null })).toBeNull()
  })

  describe('Gemini 3.8 Flash の単価の切り替え', () => {
    const base = {
      provider: 'gemini' as const,
      model: 'gemini-3.8-flash',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      searchCount: 0,
    }

    it('2026-12-31 までの回答は、入力 $0.75 / 出力 $3.75 で計算する', () => {
      const cost = estimateCostUsd({ ...base, at: new Date('2026-12-31T23:59:59Z') })
      expect(cost).toBeCloseTo(0.75 + 3.75, 6)
    })

    it('2027-01-01 からの回答は、入力 $1.50 / 出力 $7.50 で計算する', () => {
      const cost = estimateCostUsd({ ...base, at: new Date('2027-01-01T00:00:00Z') })
      expect(cost).toBeCloseTo(1.5 + 7.5, 6)
    })
  })

  describe('Gemini の Google 検索の無料枠', () => {
    const base = {
      provider: 'gemini' as const,
      model: 'gemini-3.8-flash',
      inputTokens: 0,
      outputTokens: 0,
      searchCount: 3,
      at: NOV_2026,
    }

    it('当月の検索の回数と合わせて無料枠に収まると、検索の費用は 0 になる', () => {
      const cost = estimateCostUsd({
        ...base,
        searchesUsedThisMonth: GEMINI_FREE_SEARCHES_PER_MONTH - 3,
      })
      expect(cost).toBe(0)
    })

    it('残りの無料枠が足りないときは、超えた分の検索だけ $14/1k かかる', () => {
      // 残り 1 回で 3 回検索したら、2 回分
      const cost = estimateCostUsd({
        ...base,
        searchesUsedThisMonth: GEMINI_FREE_SEARCHES_PER_MONTH - 1,
      })
      expect(cost).toBeCloseTo(2 * 0.014, 6)
    })

    it('無料枠を使い切ったあとは、検索 1 回ごとに $14/1k かかる', () => {
      const cost = estimateCostUsd({
        ...base,
        searchesUsedThisMonth: GEMINI_FREE_SEARCHES_PER_MONTH + 10,
      })
      expect(cost).toBeCloseTo(3 * 0.014, 6)
    })

    it('当月の利用回数を渡さないと、無料枠を考えない（上限側の見積もり）', () => {
      expect(estimateCostUsd(base)).toBeCloseTo(3 * 0.014, 6)
    })

    it('OpenAI の検索には無料枠がない', () => {
      const cost = estimateCostUsd({
        ...base,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        searchCount: 1,
        searchesUsedThisMonth: 0,
      })
      expect(cost).toBeCloseTo(0.01, 6)
    })
  })
})

describe('hasFreeSearchTier', () => {
  it('Gemini 3.8 Flash には検索の無料枠があり、OpenAI と料金表にないモデルにはない', () => {
    expect(hasFreeSearchTier({ provider: 'gemini', model: 'gemini-3.8-flash', at: NOV_2026 })).toBe(
      true,
    )
    expect(hasFreeSearchTier({ provider: 'openai', model: 'gpt-5.4-mini', at: NOV_2026 })).toBe(
      false,
    )
    expect(hasFreeSearchTier({ provider: 'gemini', model: 'fake-gemini', at: NOV_2026 })).toBe(
      false,
    )
    expect(
      hasFreeSearchTier({ provider: 'gemini', model: 'gemini-3.8-flash-2026-11-01', at: NOV_2026 }),
    ).toBe(true)
  })
})

describe('typicalAnswerCostUsd', () => {
  it('1 回答あたりの目安は、本番の実測（ChatGPT 約 $0.019、Gemini 約 $0.007）に合う', () => {
    // ChatGPT：入力 6,000 × $0.75/M + 出力 1,000 × $4.50/M + 検索 1 回 × $10/1k
    const openai = typicalAnswerCostUsd({ provider: 'openai', model: 'gpt-5.4-mini', at: NOV_2026 })
    expect(openai).toBeCloseTo(0.0045 + 0.0045 + 0.01, 6)
    expect(openai).toBeCloseTo(0.019, 3)
    // Gemini：入力 100 × $0.75/M + 出力 1,850 × $3.75/M。検索は無料枠に収まるので $0
    const gemini = typicalAnswerCostUsd({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      at: NOV_2026,
    })
    expect(gemini).toBeCloseTo(0.000075 + 0.0069375, 6)
    expect(gemini).toBeCloseTo(0.007, 3)
  })

  it('検索の無料枠を使い切ったあとは、検索の分も入る（無料枠のない ChatGPT は変わらない）', () => {
    const beyond = { at: NOV_2026, beyondFreeSearches: true }
    // Gemini：上の額 + 検索 2 回 × $14/1k
    expect(
      typicalAnswerCostUsd({ provider: 'gemini', model: 'gemini-3.8-flash', ...beyond }),
    ).toBeCloseTo(0.000075 + 0.0069375 + 0.028, 5) // 費用は小数 6 桁に丸める
    expect(
      typicalAnswerCostUsd({ provider: 'openai', model: 'gpt-5.4-mini', ...beyond }),
    ).toBeCloseTo(0.019, 6)
  })

  it('単価が変わる日を過ぎると、新しい単価で出す', () => {
    const cost = typicalAnswerCostUsd({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      at: new Date('2027-01-01T00:00:00Z'),
    })
    expect(cost).toBeCloseTo(0.00015 + 0.013875, 6)
  })

  it('料金表にないモデルは null', () => {
    expect(typicalAnswerCostUsd({ provider: 'openai', model: 'unknown', at: NOV_2026 })).toBeNull()
  })
})
