import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type { AnswerProvider, AskInput, AskResult } from '../types'

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'

/**
 * OpenAI（Responses API ＋ Web 検索ツール）。
 * 検索するかどうかはモデルに任せる（ChatGPT の普段の動きに近づけるため）。
 */
export function createOpenAIProvider(options: {
  apiKey: string
  model?: string
  maxRetries?: number
}): AnswerProvider {
  const openai = createOpenAI({ apiKey: options.apiKey })
  const model = options.model ?? DEFAULT_OPENAI_MODEL

  return {
    id: 'openai',
    model,
    async ask(input: AskInput): Promise<AskResult> {
      const startedAt = performance.now()
      const result = await generateText({
        model: openai.responses(model),
        prompt: input.prompt,
        tools: {
          web_search: openai.tools.webSearch({
            searchContextSize: 'medium',
            userLocation: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' },
          }),
        },
        maxRetries: options.maxRetries ?? 2,
        abortSignal: input.abortSignal,
      })

      const searchCount = result.steps
        .flatMap((step) => step.content)
        .filter((part) => part.type === 'tool-call' && part.toolName === 'web_search').length

      return {
        provider: 'openai',
        model: result.response.modelId ?? model,
        text: result.text,
        sources: result.sources.flatMap((s) =>
          s.sourceType === 'url' ? [{ url: s.url, title: s.title }] : [],
        ),
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        searchCount,
        latencyMs: Math.round(performance.now() - startedAt),
      }
    },
  }
}
