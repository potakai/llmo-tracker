import { brand as brandTable, type Db, siteAudit, siteAuditCheck, siteAuditPage } from '@llmo/db'
import { createRobotsGuardedFetcher, siteOrigin } from '@llmo/site'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { abandonSiteAudit } from './abandon'
import { defaultSleep, type SiteAuditDeps, SiteAuditNotFoundError, stopReasonOf } from './deps'
import { FAKE_PAGE_CONCURRENCY, LIVE_PAGE_CONCURRENCY, LIVE_REQUEST_INTERVAL_MS } from './limits'
import type { SiteFacts } from './plan'
import { auditPage, checkRows, type PageOutcome, pageRowValues } from './read-page'

export type PagesSliceOptions = {
  /** この時間を過ぎたら、新しくページを読み始めない（読み途中のページは待つ） */
  budgetMs: number
}

export type PagesSliceResult = { remaining: number }

type PendingPage = { id: string; url: string }

/**
 * 診断の 2 段目：まだ読んでいないページを、予算の時間まで読んで診断する。
 * 本物のサイトは、同時に LIVE_PAGE_CONCURRENCY ページまで、LIVE_REQUEST_INTERVAL_MS あけて読む。
 * 1 ページ読むごとに保存するので、どこで落ちても次は続きから読む
 */
export async function auditPagesSlice(
  deps: SiteAuditDeps,
  auditId: string,
  options: PagesSliceOptions,
): Promise<PagesSliceResult> {
  const { db } = deps
  const startedAt = Date.now()
  const audit = await loadAuditForPages(db, auditId)
  if (audit.status !== 'running') return { remaining: 0 }
  // 読む直前に、今のブランドのドメインと、本物を読む許可を確かめる
  const stop = stopReasonOf(deps, audit)
  if (stop) {
    await abandonSiteAudit(db, auditId, stop)
    return { remaining: 0 }
  }

  // すべてのリクエストの前に robots.txt を当てる。一覧を作ったときに読んだ robots.txt は読み直さない
  const facts = audit.siteFacts as SiteFacts | null
  const fetcher = createRobotsGuardedFetcher(
    deps.fetcherFor(audit.mode, { registeredDomain: audit.domain, brandName: audit.brandName }),
    { known: facts ? [[siteOrigin(audit.domain), facts.robots]] : [] },
  )
  const isLive = fetcher.mode === 'live'
  const concurrency = isLive ? LIVE_PAGE_CONCURRENCY : FAKE_PAGE_CONCURRENCY
  const sleep = deps.sleep ?? defaultSleep
  const names = [audit.brandName, ...audit.aliases]

  // 予算が小さくても、1 回分は必ず読む（ジョブが進まなくならないように）
  for (let batch = 0; batch === 0 || Date.now() - startedAt < options.budgetMs; batch += 1) {
    const pending = await pendingPages(db, auditId, concurrency)
    if (pending.length === 0) break
    if (batch > 0 && isLive) await sleep(LIVE_REQUEST_INTERVAL_MS)
    await Promise.all(
      pending.map(async (page) =>
        savePage(db, auditId, page.id, await auditPage(fetcher, page.url, names)),
      ),
    )
  }
  return { remaining: await countPending(db, auditId) }
}

async function loadAuditForPages(db: Db, auditId: string) {
  const [audit] = await db
    .select({
      status: siteAudit.status,
      mode: siteAudit.mode,
      domain: siteAudit.domain,
      brandName: brandTable.name,
      aliases: brandTable.aliases,
      organizationId: brandTable.organizationId,
      currentDomain: brandTable.domain,
      siteFacts: siteAudit.siteFacts,
    })
    .from(siteAudit)
    .innerJoin(brandTable, eq(brandTable.id, siteAudit.brandId))
    .where(eq(siteAudit.id, auditId))
  if (!audit) throw new SiteAuditNotFoundError(auditId)
  return audit
}

function pendingPages(db: Db, auditId: string, limit: number): Promise<PendingPage[]> {
  return db
    .select({ id: siteAuditPage.id, url: siteAuditPage.url })
    .from(siteAuditPage)
    .where(and(eq(siteAuditPage.auditId, auditId), eq(siteAuditPage.status, 'pending')))
    .orderBy(asc(siteAuditPage.position))
    .limit(limit)
}

async function countPending(db: Db, auditId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(siteAuditPage)
    .where(and(eq(siteAuditPage.auditId, auditId), eq(siteAuditPage.status, 'pending')))
  return row?.n ?? 0
}

/** 読んだ結果を保存する。すでに保存されていれば（ジョブのやり直し）何もしない */
async function savePage(db: Db, auditId: string, pageId: string, outcome: PageOutcome) {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(siteAuditPage)
      .set({ ...pageRowValues(outcome), fetchedAt: sql`now()` })
      .where(and(eq(siteAuditPage.id, pageId), eq(siteAuditPage.status, 'pending')))
      .returning({ id: siteAuditPage.id })
    if (!updated || outcome.checks.length === 0) return
    await tx
      .insert(siteAuditCheck)
      .values(checkRows(auditId, pageId, outcome.checks))
      .onConflictDoNothing()
  })
}
