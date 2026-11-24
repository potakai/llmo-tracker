import { type CheckStatus, siteAudit, siteAuditCheck, siteAuditPage } from '@llmo/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  bySeverity,
  type CheckChanges,
  type ComparableCheck,
  diffChecks,
} from '@/lib/site-audit-diff'
import { todayInTokyo } from '@/lib/stats'
import { inOrganization } from './tenant'

/** 「今すぐ診断」が使えるかを見るのに、新しい順に何回分を読むか（今日の手動と、直近 2 回の成功が入る数） */
const RECENT_AUDITS = 10

export type SiteAuditSummary = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  trigger: 'scheduled' | 'manual'
  mode: 'live' | 'fake'
  requestedOn: string
  domain: string
  finishedAt: Date | null
  error: string | null
}

export type SiteCheckRow = ComparableCheck & { detail: unknown }

export type SiteAuditPageRow = {
  id: string
  url: string
  source: 'top' | 'cited' | 'sitemap' | 'link'
  status: 'pending' | 'fetched' | 'failed' | 'skipped'
  httpStatus: number | null
  error: string | null
  critical: number
  warning: number
}

export type SiteAuditOverview = SiteAuditState & {
  /** 結果を出す診断（いちばん新しい成功）。まだなければ null */
  current: SiteAuditSummary | null
  previous: SiteAuditSummary | null
  siteChecks: SiteCheckRow[]
  pages: SiteAuditPageRow[]
  /** 前回の成功した診断からの変化。前回がなければ null */
  changes: CheckChanges | null
}

const summaryColumns = {
  id: siteAudit.id,
  status: siteAudit.status,
  trigger: siteAudit.trigger,
  mode: siteAudit.mode,
  requestedOn: siteAudit.requestedOn,
  domain: siteAudit.domain,
  finishedAt: siteAudit.finishedAt,
  error: siteAudit.error,
}

/** ブランドの最近の診断（その組織のものだけ、新しい順） */
function recentAudits(organizationId: string, brandId: string): Promise<SiteAuditSummary[]> {
  return db
    .select(summaryColumns)
    .from(siteAudit)
    .where(and(eq(siteAudit.brandId, brandId), inOrganization(siteAudit.brandId, organizationId)))
    .orderBy(desc(siteAudit.createdAt))
    .limit(RECENT_AUDITS)
}

/** 診断の項目（ページの URL つき）。その組織のブランドの診断のものだけ */
function checksOf(organizationId: string, auditIds: string[]) {
  if (auditIds.length === 0) return Promise.resolve([])
  return db
    .select({
      auditId: siteAuditCheck.auditId,
      pageId: siteAuditCheck.pageId,
      pageUrl: siteAuditPage.url,
      key: siteAuditCheck.key,
      status: siteAuditCheck.status,
      message: siteAuditCheck.message,
      detail: siteAuditCheck.detail,
    })
    .from(siteAuditCheck)
    .innerJoin(siteAudit, eq(siteAudit.id, siteAuditCheck.auditId))
    .leftJoin(siteAuditPage, eq(siteAuditPage.id, siteAuditCheck.pageId))
    .where(
      and(
        inArray(siteAuditCheck.auditId, auditIds),
        inOrganization(siteAudit.brandId, organizationId),
      ),
    )
    .orderBy(asc(siteAuditCheck.id))
}

function pagesOf(organizationId: string, auditIds: string[]) {
  if (auditIds.length === 0) return Promise.resolve([])
  return db
    .select({
      auditId: siteAuditPage.auditId,
      id: siteAuditPage.id,
      url: siteAuditPage.url,
      source: siteAuditPage.source,
      status: siteAuditPage.status,
      httpStatus: siteAuditPage.httpStatus,
      error: siteAuditPage.error,
    })
    .from(siteAuditPage)
    .innerJoin(siteAudit, eq(siteAudit.id, siteAuditPage.auditId))
    .where(
      and(
        inArray(siteAuditPage.auditId, auditIds),
        inOrganization(siteAudit.brandId, organizationId),
      ),
    )
    .orderBy(asc(siteAuditPage.position))
}

type PageLike = { status: SiteAuditPageRow['status']; url: string }

const auditedPages = (pages: PageLike[]) => ({
  fetched: new Set(pages.filter((p) => p.status === 'fetched').map((p) => p.url)),
  audited: new Set(
    pages.filter((p) => p.status === 'fetched' || p.status === 'failed').map((p) => p.url),
  ),
})

export type SiteAuditState = {
  latest: SiteAuditSummary | null
  /** 診断が動いている（queued / running）か */
  isRunning: boolean
  manualUsedToday: boolean
}

/** 「今すぐ診断」のボタン用：いちばん新しい診断と、今日もう手動で診断したか */
export async function getSiteAuditState(
  organizationId: string,
  brandId: string,
): Promise<SiteAuditState> {
  return stateOf(await recentAudits(organizationId, brandId))
}

function stateOf(audits: SiteAuditSummary[]): SiteAuditState {
  const latest = audits[0] ?? null
  return {
    latest,
    isRunning: latest?.status === 'queued' || latest?.status === 'running',
    manualUsedToday: audits.some((a) => a.trigger === 'manual' && a.requestedOn === todayInTokyo()),
  }
}

/** サイト診断のタブに出すもの：最新の結果、ページごとの一覧、前回からの変化 */
export async function getSiteAuditOverview(
  organizationId: string,
  brandId: string,
): Promise<SiteAuditOverview> {
  const audits = await recentAudits(organizationId, brandId)
  const [current, previous] = audits.filter((a) => a.status === 'succeeded')
  const base = {
    ...stateOf(audits),
    current: current ?? null,
    previous: previous ?? null,
  }
  if (!current) return { ...base, siteChecks: [], pages: [], changes: null }

  const ids = previous ? [current.id, previous.id] : [current.id]
  const [checks, pages] = await Promise.all([
    checksOf(organizationId, ids),
    pagesOf(organizationId, ids),
  ])
  const comparable = (auditId: string): SiteCheckRow[] =>
    checks
      .filter((c) => c.auditId === auditId)
      .map((c) => ({
        pageUrl: c.pageId ? c.pageUrl : null,
        key: c.key,
        status: c.status,
        message: c.message,
        detail: c.detail,
      }))
  const currentChecks = comparable(current.id)
  const currentPages = pages.filter((p) => p.auditId === current.id)
  const count = (pageId: string, status: CheckStatus) =>
    checks.filter((c) => c.pageId === pageId && c.status === status).length

  return {
    ...base,
    siteChecks: bySeverity(currentChecks.filter((c) => c.pageUrl === null)),
    pages: currentPages.map(({ auditId: _auditId, ...p }) => ({
      ...p,
      critical: count(p.id, 'critical'),
      warning: count(p.id, 'warning'),
    })),
    changes: previous
      ? diffChecks(comparable(previous.id), currentChecks, {
          previous: auditedPages(pages.filter((p) => p.auditId === previous.id)),
          current: auditedPages(currentPages),
        })
      : null,
  }
}

/** ページの詳細（診断の項目と、HTML から取り出したもの）。その組織のブランドのページでなければ null */
export async function getSiteAuditPageDetail(
  organizationId: string,
  brandId: string,
  pageId: string,
) {
  const [page] = await db
    .select({
      id: siteAuditPage.id,
      auditId: siteAuditPage.auditId,
      url: siteAuditPage.url,
      finalUrl: siteAuditPage.finalUrl,
      source: siteAuditPage.source,
      status: siteAuditPage.status,
      httpStatus: siteAuditPage.httpStatus,
      facts: siteAuditPage.facts,
      error: siteAuditPage.error,
      requestedOn: siteAudit.requestedOn,
    })
    .from(siteAuditPage)
    .innerJoin(siteAudit, eq(siteAudit.id, siteAuditPage.auditId))
    .where(
      and(
        eq(siteAuditPage.id, pageId),
        eq(siteAudit.brandId, brandId),
        inOrganization(siteAudit.brandId, organizationId),
      ),
    )
  if (!page) return null
  const checks = await db
    .select({
      key: siteAuditCheck.key,
      status: siteAuditCheck.status,
      message: siteAuditCheck.message,
      detail: siteAuditCheck.detail,
    })
    .from(siteAuditCheck)
    .innerJoin(siteAudit, eq(siteAudit.id, siteAuditCheck.auditId))
    .where(
      and(
        eq(siteAuditCheck.pageId, page.id),
        eq(siteAuditCheck.auditId, page.auditId),
        inOrganization(siteAudit.brandId, organizationId),
      ),
    )
    .orderBy(asc(siteAuditCheck.id))
  return { ...page, checks: bySeverity(checks) }
}
