import { citation, mention, type PromptKind, prompt, response, run } from '@llmo/db'
import type { LlmMode } from '@llmo/llm'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { countedResponses } from './sample-responses'
import { inOrganization } from './tenant'

/** ブランドの質問を 1 件（アーカイブ済みも含む）。他のブランド・他の組織のものなら null */
export async function findPromptInBrand(organizationId: string, brandId: string, promptId: string) {
  const [found] = await db
    .select()
    .from(prompt)
    .where(
      and(
        eq(prompt.id, promptId),
        eq(prompt.brandId, brandId),
        inOrganization(prompt.brandId, organizationId),
      ),
    )
    .limit(1)
  return found ?? null
}

/** 質問の種類を変える。他のブランド・他の組織の質問なら何も変えずに null */
export async function updatePromptKind(
  organizationId: string,
  brandId: string,
  promptId: string,
  kind: PromptKind,
) {
  const [updated] = await db
    .update(prompt)
    .set({ kind })
    .where(
      and(
        eq(prompt.id, promptId),
        eq(prompt.brandId, brandId),
        inOrganization(prompt.brandId, organizationId),
      ),
    )
    .returning()
  return updated ?? null
}

/** 回答 1 件を画面に出すのに要るもの（ResponseView）。日付・引用元・分析結果・言及 */
export const RESPONSE_VIEW_WITH = {
  run: { columns: { scheduledFor: true, createdAt: true } },
  citations: { orderBy: asc(citation.position) },
  analysis: { columns: { extractorModel: true, sentiment: true } },
  mentions: { orderBy: asc(mention.rank) },
} as const

/**
 * 質問への最近の回答（新しい順）。回答・引用元・分析結果・言及つき。
 * 回答の run が他の組織のブランドのものなら出さない。
 * llmMode が live なら、サンプルの AI（fake）の回答は出さない
 */
export async function listPromptResponses(
  organizationId: string,
  promptId: string,
  llmMode: LlmMode,
  options: { provider?: 'openai' | 'gemini'; limit?: number } = {},
) {
  return db.query.response.findMany({
    where: and(
      eq(response.promptId, promptId),
      inArray(
        response.runId,
        db.select({ id: run.id }).from(run).where(inOrganization(run.brandId, organizationId)),
      ),
      countedResponses(llmMode),
      options.provider ? eq(response.provider, options.provider) : undefined,
    ),
    orderBy: [desc(response.createdAt), desc(response.sampleIndex)],
    limit: options.limit ?? 30,
    with: RESPONSE_VIEW_WITH,
  })
}
