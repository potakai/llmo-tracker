import {
  brand as brandTable,
  citation,
  type Db,
  response,
  run,
  siteAudit,
  siteAuditPage,
} from '@llmo/db'
import {
  extractPageFacts,
  isAllowedByRobotsState,
  OWN_CRAWLER_TOKEN,
  parseRobotsTxt,
  parseSitemap,
  type RobotsState,
  SiteFetchError,
  type SiteFetcher,
  siteOrigin,
  toAuditableUrl,
} from '@llmo/site'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { abandonSiteAudit } from './abandon'
import {
  isModeStillAllowed,
  LIVE_NOT_ALLOWED_MESSAGE,
  type SiteAuditDeps,
  SiteAuditNotFoundError,
} from './deps'
import {
  CITED_LOOKBACK_DAYS,
  MAX_AUDIT_PAGES,
  MAX_ROBOTS_TXT_CHARS,
  MAX_SITEMAP_FILES,
} from './limits'

/** サイト全体の材料（site_audit.site_facts に保存する） */
export type SiteFacts = {
  /** robots.txt の状態。found なら本文も残す（サイト全体の診断で読み直す） */
  robots:
    | { kind: 'found'; text: string }
    | { kind: 'missing' }
    | { kind: 'unreachable'; reason: string }
  hasLlmsTxt: boolean
  hasSitemap: boolean
}

export function robotsStateOf(facts: SiteFacts): RobotsState {
  if (facts.robots.kind === 'found') {
    return { kind: 'found', robots: parseRobotsTxt(facts.robots.text) }
  }
  return facts.robots
}

type PageSource = 'top' | 'cited' | 'sitemap' | 'link'
type PlannedPage = { url: string; source: PageSource }

export type PrepareResult =
  /** ページの一覧ができた（前回作ってあったものを含む） */
  | { kind: 'planned' }
  /** もう終わっている */
  | { kind: 'finished' }

/**
 * 診断の 1 段目：robots.txt・llms.txt・sitemap を読み、読むページの一覧を作る。
 * 一覧を作ってあれば何もしない（ジョブのやり直しで、一覧が変わらないように）
 */
export async function prepareSiteAudit(
  deps: SiteAuditDeps,
  auditId: string,
): Promise<PrepareResult> {
  const { db } = deps
  const audit = await loadAudit(db, auditId)
  if (audit.status === 'succeeded' || audit.status === 'failed') return { kind: 'finished' }
  if (!isModeStillAllowed(deps, audit.mode, audit.organizationId)) {
    await abandonSiteAudit(db, auditId, LIVE_NOT_ALLOWED_MESSAGE)
    return { kind: 'finished' }
  }
  await db
    .update(siteAudit)
    .set({ status: 'running', startedAt: sql`coalesce(${siteAudit.startedAt}, now())` })
    .where(and(eq(siteAudit.id, auditId), eq(siteAudit.status, audit.status)))
  if (audit.plannedAt) return { kind: 'planned' }

  const fetcher = deps.fetcherFor(audit.mode, {
    registeredDomain: audit.domain,
    brandName: audit.brandName,
  })
  const origin = siteOrigin(audit.domain)
  // robots.txt が通信のエラーで読めないときは、サイト自体に届かないので、ここで診断を失敗にする（呼び出し側で）
  const robots = await readRobots(fetcher, origin)
  const robotsState = robotsStateOf({ robots, hasLlmsTxt: false, hasSitemap: false })
  const [hasLlmsTxt, sitemap] = await Promise.all([
    readLlmsTxt(fetcher, origin),
    readSitemaps(fetcher, audit.domain, origin, robotsState),
  ])
  const links = sitemap.urls.length === 0 ? await readTopLinks(fetcher, origin) : []
  const cited = await citedOwnUrls(db, audit.brandId)

  const planned = planPages(audit.domain, origin, [
    ...cited.map((url) => ({ url, source: 'cited' as const })),
    ...sitemap.urls.map((url) => ({ url, source: 'sitemap' as const })),
    ...links.map((url) => ({ url, source: 'link' as const })),
  ])
  const facts: SiteFacts = { robots, hasLlmsTxt, hasSitemap: sitemap.found }
  await savePlan(db, auditId, planned, facts, robotsState)
  return { kind: 'planned' }
}

async function loadAudit(db: Db, auditId: string) {
  const [audit] = await db
    .select({
      status: siteAudit.status,
      mode: siteAudit.mode,
      domain: siteAudit.domain,
      brandId: siteAudit.brandId,
      plannedAt: siteAudit.plannedAt,
      brandName: brandTable.name,
      organizationId: brandTable.organizationId,
    })
    .from(siteAudit)
    .innerJoin(brandTable, eq(brandTable.id, siteAudit.brandId))
    .where(eq(siteAudit.id, auditId))
  if (!audit) throw new SiteAuditNotFoundError(auditId)
  return audit
}

async function readRobots(fetcher: SiteFetcher, origin: string): Promise<SiteFacts['robots']> {
  const res = await fetcher.fetch(`${origin}/robots.txt`)
  if (res.status >= 200 && res.status < 300) {
    return { kind: 'found', text: res.body.slice(0, MAX_ROBOTS_TXT_CHARS) }
  }
  if (res.status >= 400 && res.status < 500) return { kind: 'missing' }
  return { kind: 'unreachable', reason: `HTTP ${res.status}` }
}

/** llms.txt があるか。ないページでも 200 で HTML を返すサイトがあるので、HTML なら「ない」とみなす */
async function readLlmsTxt(fetcher: SiteFetcher, origin: string): Promise<boolean> {
  const res = await fetcher.fetch(`${origin}/llms.txt`).catch(() => null)
  if (!res || res.status < 200 || res.status >= 300) return false
  const body = res.body.trim()
  return body !== '' && !/^<(!doctype|html)/i.test(body)
}

/** robots.txt の Sitemap: の行（なければ /sitemap.xml）から、ページの URL を集める */
async function readSitemaps(
  fetcher: SiteFetcher,
  domain: string,
  origin: string,
  robots: RobotsState,
): Promise<{ found: boolean; urls: string[] }> {
  const declared = robots.kind === 'found' ? robots.robots.sitemaps : []
  // 登録したドメインの外の sitemap は、一覧にも入れない（sitemapindex の中のものも）
  const inSite = (list: string[]) =>
    list
      .map((url) => toAuditableUrl(url, domain)?.href)
      .filter((url): url is string => url !== undefined)
  const queue = inSite(declared.length > 0 ? declared : [`${origin}/sitemap.xml`])
  const seen = new Set<string>()
  const urls: string[] = []
  let found = false
  while (queue.length > 0 && seen.size < MAX_SITEMAP_FILES && urls.length < MAX_AUDIT_PAGES) {
    const next = queue.shift() as string
    if (seen.has(next)) continue
    seen.add(next)
    const res = await fetcher.fetch(next).catch(() => null)
    if (!res || res.status < 200 || res.status >= 300) continue
    const sitemap = parseSitemap(res.body)
    if (sitemap.kind === 'invalid') continue
    found = true
    if (sitemap.kind === 'index') queue.push(...inSite(sitemap.sitemaps))
    else urls.push(...sitemap.urls)
  }
  return { found, urls }
}

/** sitemap がないときは、トップページのリンクからページを探す */
async function readTopLinks(fetcher: SiteFetcher, origin: string): Promise<string[]> {
  const res = await fetcher.fetch(`${origin}/`).catch(() => null)
  if (!res || res.status < 200 || res.status >= 300) return []
  return extractPageFacts(res.body, { url: res.url }).links
}

/** このブランドの AI の回答で引用された、自社サイトのページ（引用が多い順） */
async function citedOwnUrls(db: Db, brandId: string): Promise<string[]> {
  const since = new Date(Date.now() - CITED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({ url: citation.url, n: count() })
    .from(citation)
    .innerJoin(response, eq(response.id, citation.responseId))
    .innerJoin(run, eq(run.id, response.runId))
    .where(
      and(eq(run.brandId, brandId), eq(citation.isOwnDomain, true), gte(response.createdAt, since)),
    )
    .groupBy(citation.url)
    .orderBy(desc(count()), citation.url)
    .limit(MAX_AUDIT_PAGES)
  return rows.map((r) => r.url)
}

/**
 * 読むページの一覧。トップページ → AI の回答で引用されたページ → sitemap → トップページのリンク の順に、
 * 登録したドメインのページだけを、重複を除いて MAX_AUDIT_PAGES まで
 * （GA4 との連携ができたら、AI からよく入られているページを、引用されたページの前に入れる）
 */
export function planPages(
  domain: string,
  origin: string,
  candidates: PlannedPage[],
): PlannedPage[] {
  const planned: PlannedPage[] = []
  const seen = new Set<string>()
  for (const candidate of [{ url: `${origin}/`, source: 'top' as const }, ...candidates]) {
    const url = toAuditableUrl(candidate.url, domain)
    if (!url || seen.has(url.href)) continue
    seen.add(url.href)
    planned.push({ url: url.href, source: candidate.source })
    if (planned.length >= MAX_AUDIT_PAGES) break
  }
  return planned
}

async function savePlan(
  db: Db,
  auditId: string,
  planned: PlannedPage[],
  facts: SiteFacts,
  robots: RobotsState,
) {
  await db.transaction(async (tx) => {
    await tx
      .insert(siteAuditPage)
      .values(
        planned.map((page, position) => {
          // このツールが robots.txt で止められているページは読まない
          const allowed = isAllowedByRobotsState(robots, OWN_CRAWLER_TOKEN, page.url)
          const skipReason =
            robots.kind === 'unreachable'
              ? 'robots.txt を読めなかったため、読んでいません（robots.txt の決まりに合わせています）'
              : 'robots.txt でこのツールが止められているため、読んでいません'
          return {
            auditId,
            url: page.url,
            source: page.source,
            position,
            status: allowed ? ('pending' as const) : ('skipped' as const),
            error: allowed ? null : skipReason,
          }
        }),
      )
      .onConflictDoNothing()
    await tx
      .update(siteAudit)
      .set({ siteFacts: facts, plannedAt: sql`now()` })
      .where(eq(siteAudit.id, auditId))
  })
}

/** robots.txt を通信のエラーで読めなかった（サイト自体に届かない）とき、診断の失敗の理由にする */
export function siteUnreachableMessage(error: unknown): string | null {
  if (!(error instanceof SiteFetchError)) return null
  return `サイトを読めませんでした。${error.message}`
}
