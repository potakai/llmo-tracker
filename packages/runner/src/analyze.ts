import { analysis, type Db, mention, response, run } from '@llmo/db'
import { EXTRACTION_SCHEMA_VERSION, type ExtractionResult, type Extractor } from '@llmo/llm'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import pLimit from 'p-limit'

export type AnalyzeDeps = {
  db: Db
  extractor: Extractor
  concurrency?: number
}

/**
 * run の回答を分析して analysis / mention に保存する。
 * まだ分析していない回答と、古い版のスキーマで分析した回答だけが対象（何度呼んでも安全）。
 * force: true なら全部やり直す（抽出ロジックを直したとき用）。
 */
export async function analyzeRun(
  deps: AnalyzeDeps,
  runId: string,
  options: { force?: boolean } = {},
): Promise<{ analyzed: number }> {
  const { db } = deps

  const target = await db.query.run.findFirst({
    where: eq(run.id, runId),
    with: { brand: { with: { competitors: true } } },
  })
  if (!target) throw new Error(`run ${runId} が見つかりません`)
  const { brand } = target

  const needsAnalysis = options.force
    ? undefined
    : or(isNull(analysis.responseId), lt(analysis.schemaVersion, EXTRACTION_SCHEMA_VERSION))

  const rows = await db
    .select({ id: response.id, answerText: response.answerText })
    .from(response)
    .leftJoin(analysis, eq(analysis.responseId, response.id))
    .where(and(eq(response.runId, runId), eq(response.status, 'succeeded'), needsAnalysis))

  const limit = pLimit(deps.concurrency ?? 4)
  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const result = await deps.extractor.extract({
          answerText: row.answerText ?? '',
          brand: { name: brand.name, aliases: brand.aliases },
          competitors: brand.competitors.map((c) => ({
            id: c.id,
            name: c.name,
            aliases: c.aliases,
          })),
        })
        await saveAnalysis(db, row.id, result)
      }),
    ),
  )
  return { analyzed: rows.length }
}

async function saveAnalysis(db: Db, responseId: string, result: ExtractionResult) {
  const values = {
    responseId,
    status: 'succeeded' as const,
    brandMentioned: result.brandMentioned,
    brandRank: result.brandRank,
    sentiment: result.sentiment,
    extractorModel: result.extractorModel,
    schemaVersion: result.schemaVersion,
    raw: result.raw,
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(analysis)
      .values(values)
      .onConflictDoUpdate({
        target: analysis.responseId,
        set: { ...values, createdAt: new Date() },
      })
    // 言及は作り直す（再分析で増えたり減ったりするため）
    await tx.delete(mention).where(eq(mention.responseId, responseId))
    if (result.mentions.length > 0) {
      await tx.insert(mention).values(result.mentions.map((m) => ({ ...m, responseId })))
    }
  })
}
