import { type Db, siteAudit, siteAuditCheck, siteAuditPage } from '@llmo/db'
import { checkSite, siteOrigin } from '@llmo/site'
import { and, eq, inArray, sql } from 'drizzle-orm'

export { abandonSiteAudit } from './abandon'

import { DEFAULT_SITE_AUDIT_STALE_AFTER_MINUTES } from './limits'
import { robotsStateOf, type SiteFacts } from './plan'

/**
 * 診断の 3 段目：サイト全体の項目を診断して保存し、診断を終える。
 * 読めたページのどこかに Q&A があるか、AI のクローラーが一部のページだけ止められていないか、もここで見る
 */
export async function finishSiteAudit(db: Db, auditId: string): Promise<void> {
  const [audit] = await db
    .select({ status: siteAudit.status, domain: siteAudit.domain, siteFacts: siteAudit.siteFacts })
    .from(siteAudit)
    .where(eq(siteAudit.id, auditId))
  if (audit?.status !== 'running' || !audit.siteFacts) return

  const pages = await db
    .select({ url: siteAuditPage.url, status: siteAuditPage.status, facts: siteAuditPage.facts })
    .from(siteAuditPage)
    .where(eq(siteAuditPage.auditId, auditId))
  const facts = audit.siteFacts as SiteFacts
  const checks = checkSite({
    origin: siteOrigin(audit.domain),
    robots: robotsStateOf(facts),
    hasLlmsTxt: facts.hasLlmsTxt,
    hasSitemap: facts.hasSitemap,
    pageUrls: pages.map((p) => p.url),
    hasFaqSomewhere: pages.some((p) => (p.facts as { faq?: unknown } | null)?.faq),
  })

  await db.transaction(async (tx) => {
    await tx
      .insert(siteAuditCheck)
      .values(
        checks.map((c) => ({
          auditId,
          pageId: null,
          key: c.key,
          status: c.status,
          message: c.message,
          detail: c.detail ?? null,
        })),
      )
      .onConflictDoNothing()
    await tx
      .update(siteAudit)
      .set({ status: 'succeeded', finishedAt: sql`now()` })
      .where(and(eq(siteAudit.id, auditId), eq(siteAudit.status, 'running')))
  })
}

/**
 * 止まった診断の回収。一定時間なにも進んでいない（作成・開始・ページの保存のどれも）queued / running の診断を、
 * 理由付きで失敗にする。ジョブが落ちた・ジョブに渡せなかったなどで残った診断が、次の診断を止め続けないように
 */
export async function recoverStaleSiteAudits(
  db: Db,
  options: { staleAfterMinutes?: number; now?: Date } = {},
): Promise<number> {
  const minutes = options.staleAfterMinutes ?? DEFAULT_SITE_AUDIT_STALE_AFTER_MINUTES
  const cutoff = new Date((options.now ?? new Date()).getTime() - minutes * 60_000)
  const lastActivity = sql`greatest(
    ${siteAudit.createdAt},
    coalesce(${siteAudit.startedAt}, ${siteAudit.createdAt}),
    coalesce((select max(p.fetched_at) from site_audit_page p where p.audit_id = ${siteAudit.id}), ${siteAudit.createdAt})
  )`
  const rows = await db
    .update(siteAudit)
    .set({
      status: 'failed',
      error: '診断が途中で止まったため、終わらせました',
      finishedAt: sql`now()`,
    })
    .where(
      and(
        inArray(siteAudit.status, ['queued', 'running']),
        sql`${lastActivity} < ${cutoff.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: siteAudit.id })
  return rows.length
}
