import { describe, expect, it } from 'vitest'
import { estimateDailyRunCostUsd, formatUsd } from '@/lib/daily-cost'

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
