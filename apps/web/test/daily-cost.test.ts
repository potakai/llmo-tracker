import { describe, expect, it } from 'vitest'
import { estimateDailyRunCostRange, estimateDailyRunCostUsd, formatUsd } from '@/lib/daily-cost'

const perAnswerUsd = { openai: 0.02, gemini: 0.03 }

describe('estimateDailyRunCostUsd', () => {
  it('聞く回数 × 質問数 × AI ごとの 1 回答あたりの目安 を足す', () => {
    // 5 回 × 3 問 × (0.02 + 0.03)
    const cost = estimateDailyRunCostUsd({
      samplesPerPrompt: 5,
      promptCount: 3,
      providers: ['openai', 'gemini'],
      perAnswerUsd,
    })
    expect(cost).toBeCloseTo(0.75, 6)
  })

  it('計測しない AI の分は入らない', () => {
    const cost = estimateDailyRunCostUsd({
      samplesPerPrompt: 2,
      promptCount: 4,
      providers: ['gemini'],
      perAnswerUsd,
    })
    expect(cost).toBeCloseTo(0.24, 6)
  })

  it('目安がわからない AI があれば null（少なく見せない）', () => {
    const cost = estimateDailyRunCostUsd({
      samplesPerPrompt: 1,
      promptCount: 1,
      providers: ['openai', 'gemini'],
      perAnswerUsd: { openai: 0.02, gemini: null },
    })
    expect(cost).toBeNull()
  })
})

describe('formatUsd', () => {
  it('1 ドル未満は 3 桁、それ以上は 2 桁で表示する', () => {
    expect(formatUsd(0.0205)).toBe('$0.021')
    expect(formatUsd(12.345)).toBe('$12.35')
  })
})

describe('estimateDailyRunCostRange', () => {
  const costs = {
    perAnswerUsd: { openai: 0.019, gemini: 0.007 },
    beyondFreeSearchesUsd: { openai: 0.019, gemini: 0.0434 },
    freeSearchesPerMonth: 5_000,
  }

  it('検索の無料枠が残っている場合と、使い切った場合の毎朝の額を両方出す', () => {
    const range = estimateDailyRunCostRange({
      samplesPerPrompt: 5,
      promptCount: 2,
      providers: ['openai', 'gemini'],
      costs,
    })
    // 5 回 × 2 問 × (0.019 + 0.007) と 5 回 × 2 問 × (0.019 + 0.0434)
    expect(range.withinFreeSearches).toBeCloseTo(0.26, 6)
    expect(range.beyondFreeSearches).toBeCloseTo(0.624, 6)
    expect(range.dependsOnFreeSearches).toBe(true)
  })

  it('無料枠のある AI（Gemini）を計測しないなら、額は 1 つ（無料枠に左右されない）', () => {
    const range = estimateDailyRunCostRange({
      samplesPerPrompt: 5,
      promptCount: 2,
      providers: ['openai'],
      costs,
    })
    expect(range.withinFreeSearches).toBeCloseTo(0.19, 6)
    expect(range.beyondFreeSearches).toBeCloseTo(0.19, 6)
    expect(range.dependsOnFreeSearches).toBe(false)
  })

  it('目安がわからない AI があれば、その額は null', () => {
    const range = estimateDailyRunCostRange({
      samplesPerPrompt: 1,
      promptCount: 1,
      providers: ['gemini'],
      costs: { ...costs, beyondFreeSearchesUsd: { openai: 0.019, gemini: null } },
    })
    expect(range.withinFreeSearches).toBeCloseTo(0.007, 6)
    expect(range.beyondFreeSearches).toBeNull()
  })
})
