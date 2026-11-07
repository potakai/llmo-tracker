import { type Db, run as runTable } from '@llmo/db'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'

/** 止まったとみなすまでの時間の初期値 */
export const DEFAULT_STALE_AFTER_MINUTES = 30

export type ClosedRun = { runId: string; status: 'partial' | 'failed' }

/**
 * run が最後に進んだ時刻：作成・開始・回答の保存・分析の保存のうち、いちばん新しいもの。
 * executeRun は回答を 1 件保存するたびに response.created_at が更新されるので、動いている run はこれが進み続ける。
 */
const lastActivityAt = sql`greatest(
  ${runTable.createdAt},
  coalesce(${runTable.startedAt}, ${runTable.createdAt}),
  coalesce((select max(r.created_at) from response r where r.run_id = ${runTable.id}), ${runTable.createdAt}),
  coalesce((select max(a.created_at) from analysis a join response r on r.id = a.response_id where r.run_id = ${runTable.id}), ${runTable.createdAt})
)`

/**
 * 実行中（queued / running）の run を、途中のまま終わらせる。
 * 成功した回答が 1 件でもあれば partial（それまでの結果はダッシュボードに出る）、なければ failed。
 * 終わらせると「1 ブランドで同時に動く実行は 1 つまで」の枠が空き、次の実行ができるようになる。
 */
async function closeRuns(db: Db, where: SQL | undefined): Promise<ClosedRun[]> {
  const rows = await db
    .update(runTable)
    .set({
      status: sql`case when exists (
        select 1 from response r where r.run_id = ${runTable.id} and r.status = 'succeeded'
      ) then 'partial'::run_status else 'failed'::run_status end`,
      finishedAt: sql`now()`,
      totalCostUsd: sql`coalesce((select sum(r.cost_usd) from response r where r.run_id = ${runTable.id}), 0)`,
    })
    .where(and(inArray(runTable.status, ['queued', 'running']), where))
    .returning({ runId: runTable.id, status: runTable.status })
  return rows as ClosedRun[]
}

/**
 * 止まった run を回収する。一定時間なにも進んでいない queued / running の run を終わらせる。
 * ジョブが落ちた・ワーカーが消えたなどで残った run が、そのブランドの次の実行を止め続けないようにする。
 *
 * 判定と更新を 1 つの UPDATE で行うので、回収の直前に進んだ run を誤って終わらせることはない。
 */
export async function recoverStaleRuns(
  db: Db,
  options: { staleAfterMinutes?: number; now?: Date } = {},
): Promise<ClosedRun[]> {
  const minutes = options.staleAfterMinutes ?? DEFAULT_STALE_AFTER_MINUTES
  const cutoff = new Date((options.now ?? new Date()).getTime() - minutes * 60_000)
  return closeRuns(db, sql`${lastActivityAt} < ${cutoff.toISOString()}::timestamptz`)
}

/**
 * 1 つの run を途中のまま終わらせる。ジョブがリトライを使い切って失敗したときに呼ぶ。
 * すでに終わっている run には何もしない（null を返す）。
 */
export async function abandonRun(db: Db, runId: string): Promise<ClosedRun | null> {
  const [closed] = await closeRuns(db, eq(runTable.id, runId))
  return closed ?? null
}
