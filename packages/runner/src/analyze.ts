import { analysis, type Db, mention, response, run } from '@llmo/db'
import { EXTRACTION_SCHEMA_VERSION, type ExtractionResult, type Extractor } from '@llmo/llm'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { DEFAULT_TIMEOUT_MS, runUntilDeadline } from './deadline'

export type AnalyzeDeps = {
  db: Db
  extractor: Extractor
  concurrency?: number
  /** 1 回の抽出の上限時間。過ぎたら LLM の抽出器はルールベースに切り替える */
  timeoutMs?: number
}

/**
 * run の回答を分析して analysis / mention に保存する。
 * まだ分析していない回答と、古い版のスキーマで分析した回答だけが対象（何度呼んでも安全）。
 * force: true なら全部やり直す（抽出ロジックを直したとき用）。
 * deadline（Date.now() の値）を渡すと、それを過ぎたら新しい抽出を始めず、残りの件数を remaining で返す
 * （1 回の呼び出しを時間内に収めるため。続きはもう一度呼べば分析される）。
 */
export async function analyzeRun(
  deps: AnalyzeDeps,
  runId: string,
  options: { force?: boolean; deadline?: number } = {},
): Promise<{ analyzed: number; remaining: number }> {
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

  const analyzed = await runUntilDeadline(
    rows,
    {
      concurrency: deps.concurrency ?? 4,
      deadline: options.deadline ?? Number.POSITIVE_INFINITY,
    },
    async (row) => {
      const result = await deps.extractor.extract({
        answerText: row.answerText ?? '',
        brand: { name: brand.name, aliases: brand.aliases },
        competitors: brand.competitors.map((c) => ({
          id: c.id,
          name: c.name,
          aliases: c.aliases,
        })),
        abortSignal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
      await saveAnalysis(db, row.id, result)
    },
  )
  return { analyzed, remaining: rows.length - analyzed }
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
