import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import type { AnswerProvider, AskInput, AskResult } from '../types'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/** Gemini（Google 検索によるグラウンディング付き） */
export function createGeminiProvider(options: {
  apiKey: string
  model?: string
  maxRetries?: number
}): AnswerProvider {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey })
  const model = options.model ?? DEFAULT_GEMINI_MODEL

  return {
    id: 'gemini',
    model,
    async ask(input: AskInput): Promise<AskResult> {
      const startedAt = performance.now()
      const result = await generateText({
        model: google(model),
        prompt: input.prompt,
        tools: { google_search: google.tools.googleSearch({}) },
        maxRetries: options.maxRetries ?? 2,
        abortSignal: input.abortSignal,
      })

      // Gemini は「実際に検索したクエリ」を返すので、その数を検索回数として使う
      const metadata = result.providerMetadata?.google as
        | { groundingMetadata?: { webSearchQueries?: string[] | null } | null }
        | undefined
      const searchCount = metadata?.groundingMetadata?.webSearchQueries?.length ?? 0

      return {
        provider: 'gemini',
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
