import { brand as brandTable, type Db, siteAudit, siteAuditCheck, siteAuditPage } from '@llmo/db'
import {
  type CheckResult,
  checkPage,
  extractPageFacts,
  type FetchedResource,
  fetchFailure,
  httpStatusMessage,
  SiteFetchError,
  type SiteFetcher,
} from '@llmo/site'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { abandonSiteAudit } from './abandon'
import {
  defaultSleep,
  isModeStillAllowed,
  LIVE_NOT_ALLOWED_MESSAGE,
  type SiteAuditDeps,
  SiteAuditNotFoundError,
} from './deps'
import { FAKE_PAGE_CONCURRENCY, LIVE_PAGE_CONCURRENCY, LIVE_REQUEST_INTERVAL_MS } from './limits'

export type PagesSliceOptions = {
  /** この時間を過ぎたら、新しくページを読み始めない（読み途中のページは待つ） */
  budgetMs: number
}

export type PagesSliceResult = { remaining: number }

type PendingPage = { id: string; url: string }

/** 読んだ結果。ページの行の更新と、ページごとの項目 */
type PageOutcome = {
  status: 'fetched' | 'failed' | 'skipped'
  httpStatus: number | null
  finalUrl: string | null
  facts: unknown
  error: string | null
  checks: CheckResult[]
}

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
  if (!isModeStillAllowed(deps, audit.mode, audit.organizationId)) {
    await abandonSiteAudit(db, auditId, LIVE_NOT_ALLOWED_MESSAGE)
    return { remaining: 0 }
  }

  const fetcher = deps.fetcherFor(audit.mode, {
    registeredDomain: audit.domain,
    brandName: audit.brandName,
  })
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
        savePage(db, auditId, page, await auditPage(fetcher, page, names)),
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

/** 1 ページを読んで診断する。読めなかったことも結果として返す（例外にしない） */
export async function auditPage(
  fetcher: SiteFetcher,
  page: PendingPage,
  names: string[],
): Promise<PageOutcome> {
  let res: FetchedResource
  try {
    res = await fetcher.fetch(page.url)
  } catch (error) {
    if (!(error instanceof SiteFetchError)) throw error
    // PDF や画像は診断の対象外（問題ではない）
    if (error.reason === 'unsupported_type') {
      return { ...empty, status: 'skipped', error: error.message }
    }
    return {
      ...empty,
      status: 'failed',
      error: error.message,
      checks: [fetchFailure(error.message, { reason: error.reason })],
    }
  }
  if (res.status < 200 || res.status >= 300) {
    const message = httpStatusMessage(res.status)
    return {
      ...empty,
      status: 'failed',
      httpStatus: res.status,
      finalUrl: res.url,
      error: message,
      checks: [fetchFailure(message, { httpStatus: res.status })],
    }
  }
  const { links: _links, ...facts } = extractPageFacts(res.body, {
    url: res.url,
    names,
    xRobotsTag: res.xRobotsTag,
  })
  return {
    status: 'fetched',
    httpStatus: res.status,
    finalUrl: res.url,
    facts,
    error: null,
    checks: checkPage({ url: res.url, facts: { ...facts, links: [] }, names }),
  }
}

const empty = { httpStatus: null, finalUrl: null, facts: null, checks: [] }

/** 読んだ結果を保存する。すでに保存されていれば（ジョブのやり直し）何もしない */
async function savePage(db: Db, auditId: string, page: PendingPage, outcome: PageOutcome) {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(siteAuditPage)
      .set({
        status: outcome.status,
        httpStatus: outcome.httpStatus,
        finalUrl: outcome.finalUrl,
        facts: outcome.facts,
        error: outcome.error,
        fetchedAt: sql`now()`,
      })
      .where(and(eq(siteAuditPage.id, page.id), eq(siteAuditPage.status, 'pending')))
      .returning({ id: siteAuditPage.id })
    if (!updated || outcome.checks.length === 0) return
    await tx
      .insert(siteAuditCheck)
      .values(
        outcome.checks.map((c) => ({
          auditId,
          pageId: page.id,
          key: c.key,
          status: c.status,
          message: c.message,
          detail: c.detail ?? null,
        })),
      )
      .onConflictDoNothing()
  })
}
