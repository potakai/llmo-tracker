import 'server-only'
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  GEMINI_FREE_SEARCHES_PER_MONTH,
  type ProviderId,
  typicalAnswerCostUsd,
} from '@llmo/llm'
import type { AnswerCosts } from '@/lib/daily-cost'

/** 本番で使うモデル。OPENAI_MODEL / GEMINI_MODEL があればそれ、なければ既定値（createProvidersFromEnv と同じ） */
const modelFor = (provider: ProviderId) =>
  provider === 'openai'
    ? process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
    : process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL

/**
 * AI ごとの 1 回答あたりの費用の目安（USD）。料金表にないモデルは null。
 * ふだんの額（検索の無料枠に収まる前提）と、無料枠を使い切ったあとの額の両方を出す
 */
export function perAnswerCosts(at = new Date()): AnswerCosts {
  const costFor = (provider: ProviderId, beyondFreeSearches: boolean) =>
    typicalAnswerCostUsd({ provider, model: modelFor(provider), at, beyondFreeSearches })
  return {
    perAnswerUsd: { openai: costFor('openai', false), gemini: costFor('gemini', false) },
    beyondFreeSearchesUsd: { openai: costFor('openai', true), gemini: costFor('gemini', true) },
    freeSearchesPerMonth: GEMINI_FREE_SEARCHES_PER_MONTH,
  }
}
