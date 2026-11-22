import { brand as brandTable, type Db, run as runTable } from '@llmo/db'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'

/**
 * まだ queued の自動 run のうち、ブランドの自動計測がオフになっているものを取り消す
 * （status = cancelled、理由 = schedule_disabled）。取り消すと「1 ブランドで同時に動く実行は 1 つまで」の
 * 枠が空くので、手動の計測もできるようになる。手動の run と、動き出した（running の）run には触らない。
 * 判定と更新を 1 つの UPDATE で行うので、同時にオンに戻されても取り違えない。取り消した run の ID を返す
 */
export async function cancelScheduledRunsOfDisabledBrands(db: Db, where: SQL): Promise<string[]> {
  const rows = await db
    .update(runTable)
    .set({ status: 'cancelled', cancelReason: 'schedule_disabled', finishedAt: sql`now()` })
    .where(
      and(
        where,
        eq(runTable.status, 'queued'),
        eq(runTable.trigger, 'scheduled'),
        inArray(
          runTable.brandId,
          db
            .select({ id: brandTable.id })
            .from(brandTable)
            .where(eq(brandTable.scheduleEnabled, false)),
        ),
      ),
    )
    .returning({ id: runTable.id })
  return rows.map((r) => r.id)
}
