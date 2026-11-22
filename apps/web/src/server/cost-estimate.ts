import 'server-only'
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL, typicalAnswerCostUsd } from '@llmo/llm'
import type { ProviderKey } from '@/components/labels'

/**
 * AI ごとの 1 回答あたりの費用の目安（USD）。料金表にないモデルは null。
 * モデルは本番で使うものと同じく、OPENAI_MODEL / GEMINI_MODEL があればそれ、なければ既定値
 */
export function perAnswerCostUsd(at = new Date()): Record<ProviderKey, number | null> {
  return {
    openai: typicalAnswerCostUsd({
      provider: 'openai',
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      at,
    }),
    gemini: typicalAnswerCostUsd({
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      at,
    }),
  }
}
