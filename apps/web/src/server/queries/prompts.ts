import { prompt, response } from '@llmo/db'
import type { LlmMode } from '@llmo/llm'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { countedResponses } from './sample-responses'

/** ブランドの質問を 1 件（アーカイブ済みも含む）。他のブランドのものなら null */
export async function findPromptInBrand(brandId: string, promptId: string) {
  const [found] = await db
    .select()
    .from(prompt)
    .where(and(eq(prompt.id, promptId), eq(prompt.brandId, brandId)))
    .limit(1)
  return found ?? null
}

/**
 * 質問への最近の回答（新しい順）。回答・引用元・分析結果・言及つき。
 * llmMode が live なら、サンプルの AI（fake）の回答は出さない
 */
export async function listPromptResponses(
  promptId: string,
  llmMode: LlmMode,
  options: { provider?: 'openai' | 'gemini'; limit?: number } = {},
) {
  return db.query.response.findMany({
    where: and(
      eq(response.promptId, promptId),
      countedResponses(llmMode),
      options.provider ? eq(response.provider, options.provider) : undefined,
    ),
    orderBy: [desc(response.createdAt), desc(response.sampleIndex)],
    limit: options.limit ?? 30,
    with: {
      run: { columns: { scheduledFor: true, createdAt: true } },
      citations: { orderBy: (c, { asc }) => asc(c.position) },
      analysis: { columns: { extractorModel: true, sentiment: true } },
      mentions: { orderBy: (m, { asc }) => asc(m.rank) },
    },
  })
}
