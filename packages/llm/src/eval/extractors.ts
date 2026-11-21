import { createOpenAI } from '@ai-sdk/openai'
import { createLlmExtractor } from '../extract/llm'
import { createRuleBasedExtractor } from '../extract/rule-based'
import type { Extractor } from '../extract/types'
import { extractorModelFromEnv } from '../index'
import type { ExtractorKind } from './args'
import { createUsageTracker, type UsageTracker } from './usage'

export type EvalExtractor = {
  extractor: Extractor
  modelId: string
  /** LLM のときだけ。使ったトークン数を数える */
  usage: UsageTracker | null
}

/**
 * 評価に使う抽出器を作る。llm は本物の API を叩くので、人が手元で明示的に指定したときだけ使う。
 * モデルは本番（createExtractorFromEnv）と同じく EXTRACTOR_MODEL、なければ既定値。
 */
export function createEvalExtractor(
  kind: ExtractorKind,
  env: Record<string, string | undefined>,
): EvalExtractor {
  if (kind === 'rule') {
    return { extractor: createRuleBasedExtractor(), modelId: 'rule-based', usage: null }
  }
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      '--extractor llm には OPENAI_API_KEY が必要です。ルートの .env に設定してから実行してください',
    )
  }
  const modelId = extractorModelFromEnv(env)
  const usage = createUsageTracker(createOpenAI({ apiKey }).responses(modelId))
  return { extractor: createLlmExtractor({ model: usage.model, modelId }), modelId, usage }
}
