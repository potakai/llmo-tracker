import { createFakeProvider } from './providers/fake'
import { createGeminiProvider } from './providers/gemini'
import { createOpenAIProvider } from './providers/openai'
import type { AnswerProvider, ProviderId } from './types'

export { estimateCostUsd } from './pricing'
export { createFakeProvider } from './providers/fake'
export { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './providers/gemini'
export { createOpenAIProvider, DEFAULT_OPENAI_MODEL } from './providers/openai'
export type { AnswerProvider, AskInput, AskResult, ProviderId, Source } from './types'

export type Providers = Record<ProviderId, AnswerProvider>

/**
 * 環境変数からプロバイダーをそろえる。
 * LLM_MODE=live のときだけ本物の API を叩く（それ以外はフェイク。うっかり課金されないように）。
 */
export function createProvidersFromEnv(env: Record<string, string | undefined>): Providers {
  if (env.LLM_MODE !== 'live') {
    return { openai: createFakeProvider('openai'), gemini: createFakeProvider('gemini') }
  }
  const openaiKey = env.OPENAI_API_KEY
  const geminiKey = env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!openaiKey || !geminiKey) {
    throw new Error(
      'LLM_MODE=live には OPENAI_API_KEY と GOOGLE_GENERATIVE_AI_API_KEY の両方が必要です',
    )
  }
  return {
    openai: createOpenAIProvider({ apiKey: openaiKey, model: env.OPENAI_MODEL || undefined }),
    gemini: createGeminiProvider({ apiKey: geminiKey, model: env.GEMINI_MODEL || undefined }),
  }
}
