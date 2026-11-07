import {
  brand as brandTable,
  type Db,
  organization,
  prompt as promptTable,
  run as runTable,
} from '@llmo/db'
import { and, eq, exists, isNull } from 'drizzle-orm'
import { createScheduledRun } from './create-run'

/** organization.metadata に `{"demo":true}` が入っている組織はデモ（閲覧専用） */
export function isDemoMetadata(metadata: string | null): boolean {
  if (!metadata) return false
  try {
    return JSON.parse(metadata)?.demo === true
  } catch {
    return false
  }
}

export type DailyRunsResult = {
  /** 作った run（このあとジョブに渡す） */
  created: { runId: string; brandId: string }[]
  /** その日の run がすでにある、または実行中の run があって作らなかったブランドの数 */
  skipped: number
  /**
   * ジョブに渡す run：その日の自動実行で、まだ queued のものすべて（今回作ったものを含む）。
   * 前回 run を作ったあと、ジョブに渡す前に落ちていた分もここで拾い直す
   */
  toDispatch: string[]
}

/**
 * 毎日の自動実行：有効な質問が 1 つ以上あるブランドごとに、その日の run を作る。
 * - デモ組織は対象外（閲覧専用で、計測すると費用がかかるため）
 * - 何度呼んでも、1 ブランド 1 日 1 つ（DB の一意制約）。ジョブがリトライされても重複しない
 */
export async function createDailyRuns(db: Db, date: string): Promise<DailyRunsResult> {
  const brands = await db
    .select({ id: brandTable.id, metadata: organization.metadata })
    .from(brandTable)
    .innerJoin(organization, eq(organization.id, brandTable.organizationId))
    .where(
      exists(
        db
          .select({ one: promptTable.id })
          .from(promptTable)
          .where(and(eq(promptTable.brandId, brandTable.id), isNull(promptTable.archivedAt))),
      ),
    )
    .orderBy(brandTable.createdAt)

  const result: DailyRunsResult = { created: [], skipped: 0, toDispatch: [] }
  for (const b of brands) {
    if (isDemoMetadata(b.metadata)) continue
    const created = await createScheduledRun(db, b.id, date)
    if (created) result.created.push({ runId: created.id, brandId: b.id })
    else result.skipped += 1
  }

  const queued = await db
    .select({ id: runTable.id })
    .from(runTable)
    .where(and(eq(runTable.scheduledFor, date), eq(runTable.status, 'queued')))
  result.toDispatch = queued.map((r) => r.id)
  return result
}

/** 日本時間での日付（YYYY-MM-DD）。自動実行の「何日分の計測か」に使う */
export function tokyoDate(at: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(at)
}
