import { type Db, run as runTable } from '@llmo/db'
import { and, eq, inArray } from 'drizzle-orm'

export class RunAlreadyActiveError extends Error {
  constructor(readonly activeRunId: string) {
    super('このブランドはすでに実行中です')
  }
}

/**
 * 手動実行の run を作る。
 * 同じブランドで実行中（queued / running）のものがあれば作らない（費用の二重払いを防ぐ）。
 * DB の部分ユニークインデックスでも守っているので、同時に押されても 1 つしか作られない。
 */
export async function createManualRun(db: Db, brandId: string) {
  const [created] = await db
    .insert(runTable)
    .values({ brandId, trigger: 'manual' })
    .onConflictDoNothing()
    .returning()
  if (created) return created

  const [active] = await db
    .select({ id: runTable.id })
    .from(runTable)
    .where(and(eq(runTable.brandId, brandId), inArray(runTable.status, ['queued', 'running'])))
    .limit(1)
  throw new RunAlreadyActiveError(active?.id ?? '')
}

/**
 * 自動実行の run を作る（1 ブランド 1 日 1 回）。
 * すでにその日の run があれば作らずに null を返す。実行中の run がある場合も null。
 */
export async function createScheduledRun(db: Db, brandId: string, date: string) {
  const [created] = await db
    .insert(runTable)
    .values({ brandId, trigger: 'scheduled', scheduledFor: date })
    .onConflictDoNothing()
    .returning()
  return created ?? null
}
