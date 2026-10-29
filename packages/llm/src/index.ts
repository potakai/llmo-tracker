import { createOpenAI } from '@ai-sdk/openai'
import { createLlmExtractor } from './extract/llm'
import { createRuleBasedExtractor } from './extract/rule-based'
import type { Extractor } from './extract/types'
import { createFakeProvider } from './providers/fake'
import { createGeminiProvider } from './providers/gemini'
import { createOpenAIProvider } from './providers/openai'
import type { AnswerProvider, ProviderId } from './types'

export {
  buildExtractionPrompt,
  createLlmExtractor,
  type LlmExtraction,
  llmExtractionSchema,
  reconcile,
} from './extract/llm'
export { createRuleBasedExtractor, extractByRules, normalize } from './extract/rule-based'
export {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractedMention,
  type ExtractInput,
  type ExtractionResult,
  type Extractor,
} from './extract/types'
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

export const DEFAULT_EXTRACTOR_MODEL = 'gpt-5.4-mini'

/** 抽出器。LLM_MODE=live なら LLM、それ以外はルールベース（費用ゼロ） */
export function createExtractorFromEnv(env: Record<string, string | undefined>): Extractor {
  if (env.LLM_MODE !== 'live') return createRuleBasedExtractor()
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) throw new Error('LLM_MODE=live には OPENAI_API_KEY が必要です')
  const modelId = env.EXTRACTOR_MODEL || DEFAULT_EXTRACTOR_MODEL
  const openai = createOpenAI({ apiKey })
  return createLlmExtractor({ model: openai.responses(modelId), modelId })
}
