import { type Db, siteAudit } from '@llmo/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

/** 診断を失敗で終える。すでに終わっていれば何もしない（false を返す） */
export async function abandonSiteAudit(db: Db, auditId: string, reason: string): Promise<boolean> {
  const rows = await db
    .update(siteAudit)
    .set({ status: 'failed', error: reason, finishedAt: sql`now()` })
    .where(and(eq(siteAudit.id, auditId), inArray(siteAudit.status, ['queued', 'running'])))
    .returning({ id: siteAudit.id })
  return rows.length > 0
}
