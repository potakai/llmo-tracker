import { citation, mention, response, run } from '@llmo/db'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/** ブランドの実行一覧（新しい順。回答の成功・失敗の数つき） */
export async function listRuns(brandId: string, limit = 20) {
  return db
    .select({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      scheduledFor: run.scheduledFor,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      totalCostUsd: run.totalCostUsd,
      createdAt: run.createdAt,
      succeeded: sql<number>`count(${response.id}) filter (where ${response.status} = 'succeeded')::int`,
      failed: sql<number>`count(${response.id}) filter (where ${response.status} = 'failed')::int`,
    })
    .from(run)
    .leftJoin(response, eq(response.runId, run.id))
    .where(eq(run.brandId, brandId))
    .groupBy(run.id)
    .orderBy(desc(run.createdAt))
    .limit(limit)
}

/** 実行の詳細：回答・引用元・分析結果・言及。ブランドが違えば null */
export async function getRunDetail(brandId: string, runId: string) {
  return db.query.run.findFirst({
    where: and(eq(run.id, runId), eq(run.brandId, brandId)),
    with: {
      responses: {
        orderBy: [asc(response.promptId), asc(response.provider), asc(response.sampleIndex)],
        with: {
          prompt: { columns: { id: true, text: true } },
          citations: { orderBy: asc(citation.position) },
          analysis: true,
          mentions: { orderBy: asc(mention.rank) },
        },
      },
    },
  })
}

export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>
