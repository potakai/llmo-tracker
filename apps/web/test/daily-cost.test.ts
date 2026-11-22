import { describe, expect, it } from 'vitest'
import { estimateDailyRunCostUsd, formatUsd, freeSearchTierNotes } from '@/lib/daily-cost'

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

describe('freeSearchTierNotes', () => {
  const costs = {
    perAnswerUsd: { openai: 0.019, gemini: 0.007 },
    beyondFreeSearchesUsd: { openai: 0.019, gemini: 0.035 },
    freeSearchesPerMonth: 5_000,
  }

  it('検索の無料枠を超えると高くなる AI だけ、超えたときの 1 回答あたりと毎朝の額を出す', () => {
    const notes = freeSearchTierNotes({
      samplesPerPrompt: 5,
      promptCount: 2,
      providers: ['openai', 'gemini'],
      costs,
    })
    expect(notes).toHaveLength(1)
    expect(notes[0]?.provider).toBe('gemini')
    expect(notes[0]?.perAnswerUsd).toBeCloseTo(0.035, 6)
    // 5 回 × 2 問 × (ChatGPT 0.019 + 無料枠を超えた Gemini 0.035)
    expect(notes[0]?.dailyUsd).toBeCloseTo(0.54, 6)
  })

  it('計測しない AI の注記は出さない', () => {
    const notes = freeSearchTierNotes({
      samplesPerPrompt: 5,
      promptCount: 2,
      providers: ['openai'],
      costs,
    })
    expect(notes).toEqual([])
  })

  it('無料枠を超えたときの額がわからない AI の注記は出さない', () => {
    const notes = freeSearchTierNotes({
      samplesPerPrompt: 1,
      promptCount: 1,
      providers: ['gemini'],
      costs: { ...costs, beyondFreeSearchesUsd: { openai: 0.019, gemini: null } },
    })
    expect(notes).toEqual([])
  })
})
