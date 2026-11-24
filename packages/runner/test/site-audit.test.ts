import {
  brand as brandTable,
  citation,
  organization,
  response,
  run,
  siteAudit,
  siteAuditCheck,
  siteAuditPage,
} from '@llmo/db'
import {
  createFakeSiteFetcher,
  type FetchedResource,
  OWN_CRAWLER_TOKEN,
  SiteFetchError,
  type SiteFetcher,
  type SiteMode,
} from '@llmo/site'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  auditPagesSlice,
  createManualSiteAudit,
  createScheduledSiteAudits,
  executeSiteAudit,
  LIVE_REQUEST_INTERVAL_MS,
  MAX_AUDIT_PAGES,
  prepareOrFail,
  recoverStaleSiteAudits,
  SiteAuditAlreadyActiveError,
  SiteAuditDailyLimitError,
  type SiteAuditDeps,
} from '../src'
import { db, seedBrand } from './fixtures'

const DATE = '2026-11-23'
const DOMAIN = 'maru.example.com'
/** 本物のサイトを読む許可がある組織（テストのフェイクのサイトしか読まない） */
const allowLive = (): SiteMode => 'live'
const fakeDeps = (revision: 0 | 1 = 1): SiteAuditDeps => ({
  db,
  modeFor: allowLive,
  fetcherFor: (_mode, target) => createFakeSiteFetcher({ ...target, revision }),
})

/** URL ごとに返す中身を決めたサイト（書いていない URL は 404） */
function stubFetcher(
  mode: SiteMode,
  pages: Record<string, Partial<FetchedResource> | SiteFetchError>,
  onFetch?: (url: string) => Promise<void> | void,
): SiteFetcher {
  return {
    mode,
    async fetch(url, options) {
      // 本物・フェイクと同じく、送る直前に beforeRequest を呼ぶ（robots.txt の判定）
      await options?.beforeRequest?.(new URL(url))
      await onFetch?.(url)
      const page = pages[url]
      if (page instanceof SiteFetchError) throw page
      return {
        url,
        status: 404,
        contentType: 'text/html',
        xRobotsTag: null,
        body: '',
        ...(page ? { status: 200 } : {}),
        ...page,
      }
    },
  }
}

async function newAudit(brandId: string, mode: SiteMode = 'fake', date = DATE) {
  return createManualSiteAudit(db, { brandId, domain: DOMAIN, mode, date })
}

const pagesOf = (auditId: string) =>
  db
    .select()
    .from(siteAuditPage)
    .where(eq(siteAuditPage.auditId, auditId))
    .orderBy(asc(siteAuditPage.position))

const siteChecksOf = (auditId: string) =>
  db
    .select()
    .from(siteAuditCheck)
    .where(and(eq(siteAuditCheck.auditId, auditId), isNull(siteAuditCheck.pageId)))

async function statusOf(auditId: string) {
  const [row] = await db.select().from(siteAudit).where(eq(siteAudit.id, auditId))
  return row
}

describe('サイト診断の実行', () => {
  it('トップページ → AI の回答で引用されたページ → sitemap の順に読み、項目ごとに保存する', async () => {
    const { brand, prompts } = await seedBrand()
    // AI の回答で、自社サイトの /faq が引用された
    const [r] = await db.insert(run).values({ brandId: brand.id, trigger: 'manual' }).returning()
    const [res] = await db
      .insert(response)
      .values({
        runId: r!.id,
        promptId: prompts[0]!.id,
        provider: 'openai',
        model: 'fake',
        sampleIndex: 0,
        status: 'succeeded',
        answerText: 'x',
      })
      .returning()
    await db.insert(citation).values({
      responseId: res!.id,
      url: `https://${DOMAIN}/faq`,
      domain: DOMAIN,
      position: 0,
      isOwnDomain: true,
    })

    const audit = await newAudit(brand.id)
    await executeSiteAudit(fakeDeps(), audit.id)

    expect((await statusOf(audit.id))?.status).toBe('succeeded')
    const pages = await pagesOf(audit.id)
    expect(pages.slice(0, 3).map((p) => [p.url, p.source])).toEqual([
      [`https://${DOMAIN}/`, 'top'],
      [`https://${DOMAIN}/faq`, 'cited'],
      [`https://${DOMAIN}/features`, 'sitemap'],
    ])
    const byPath = (path: string) => pages.find((p) => p.url === `https://${DOMAIN}${path}`)
    // * の Disallow: /admin/ はこのツールにも当てはまるので、読まない
    expect(byPath('/admin/login')).toMatchObject({ status: 'skipped', httpStatus: null })
    expect(byPath('/old-campaign')).toMatchObject({ status: 'failed', httpStatus: 404 })
    expect(byPath('/faq')).toMatchObject({ status: 'fetched', httpStatus: 200 })
    expect(byPath('/faq')?.facts).toMatchObject({ faq: 'json-ld', jsonLdTypes: ['FAQPage'] })

    const site = await siteChecksOf(audit.id)
    expect(Object.fromEntries(site.map((c) => [c.key, c.status]))).toEqual({
      robots_txt: 'ok',
      // 学習用の GPTBot と CCBot だけを止めている
      ai_crawlers: 'warning',
      llms_txt: 'warning',
      sitemap: 'ok',
      faq: 'ok',
    })
    const pageChecks = await db
      .select()
      .from(siteAuditCheck)
      .where(eq(siteAuditCheck.pageId, byPath('/blog/cloud')!.id))
    expect(pageChecks.find((c) => c.key === 'noindex')?.status).toBe('critical')
  })

  it('AI の検索のクローラー（PerplexityBot）を止めていたら、サイト全体の項目が要対応になる', async () => {
    const { brand } = await seedBrand()
    const audit = await newAudit(brand.id)
    await executeSiteAudit(fakeDeps(0), audit.id)
    const check = (await siteChecksOf(audit.id)).find((c) => c.key === 'ai_crawlers')
    expect(check?.status).toBe('critical')
    expect(check?.message).toContain('PerplexityBot')
  })

  it('読むページは MAX_AUDIT_PAGES までで、登録したドメインの外の URL は一覧に入れない', async () => {
    const { brand } = await seedBrand()
    const origin = `https://${DOMAIN}`
    const locs = [
      'https://evil.example/a',
      'http://169.254.169.254/latest/meta-data/',
      ...Array.from({ length: 80 }, (_, i) => `${origin}/p/${i}`),
    ]
    const sitemap = `<urlset>${locs.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`
    const fetcher = stubFetcher('fake', {
      [`${origin}/robots.txt`]: { body: '' },
      [`${origin}/sitemap.xml`]: { body: sitemap },
    })
    const audit = await newAudit(brand.id)
    await prepareOrFail({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)
    const pages = await pagesOf(audit.id)
    expect(pages).toHaveLength(MAX_AUDIT_PAGES)
    expect(pages.every((p) => p.url.startsWith(`${origin}/`))).toBe(true)
  })

  it('robots.txt がサーバーのエラーで読めなければ、ページは読まずに要対応にする', async () => {
    const { brand } = await seedBrand()
    const fetched: string[] = []
    const fetcher = stubFetcher(
      'fake',
      { [`https://${DOMAIN}/robots.txt`]: { status: 503 } },
      (url) => {
        fetched.push(url)
      },
    )
    const audit = await newAudit(brand.id)
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)

    expect((await statusOf(audit.id))?.status).toBe('succeeded')
    expect((await pagesOf(audit.id)).every((p) => p.status === 'skipped')).toBe(true)
    // RFC 9309 どおり「すべて禁止」として、robots.txt のほかは llms.txt も sitemap も読まない
    expect(fetched).toEqual([`https://${DOMAIN}/robots.txt`])
    const robots = (await siteChecksOf(audit.id)).find((c) => c.key === 'robots_txt')
    expect(robots?.status).toBe('critical')
  })

  it('robots.txt でこのツールが止められていたら、トップページ・sitemap・llms.txt も読まない', async () => {
    const { brand } = await seedBrand()
    const fetched: string[] = []
    const origin = `https://${DOMAIN}`
    const fetcher = stubFetcher(
      'fake',
      {
        [`${origin}/robots.txt`]: {
          body: `User-agent: ${OWN_CRAWLER_TOKEN}\nDisallow: /\nSitemap: ${origin}/sitemap.xml`,
        },
        [`${origin}/sitemap.xml`]: {
          body: '<urlset><url><loc>https://maru.example.com/a</loc></url></urlset>',
        },
        [`${origin}/`]: { body: '<a href="/b">b</a>' },
      },
      (url) => {
        fetched.push(url)
      },
    )
    const audit = await newAudit(brand.id)
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)
    expect(fetched).toEqual([`${origin}/robots.txt`])
    expect((await pagesOf(audit.id)).map((p) => p.status)).toEqual(['skipped'])
  })

  it('sitemap がなくても、トップページは 1 回だけ読み、HTML を読むのは 50 回まで', async () => {
    const { brand } = await seedBrand()
    const origin = `https://${DOMAIN}`
    const links = Array.from({ length: 80 }, (_, i) => `<a href="/p/${i}">${i}</a>`).join('')
    const pages: Record<string, Partial<FetchedResource>> = {
      [`${origin}/robots.txt`]: { body: '' },
      [`${origin}/`]: { body: `<title>トップ</title>${links}` },
    }
    for (let i = 0; i < 80; i += 1) pages[`${origin}/p/${i}`] = { body: '<p>x</p>' }
    const fetched: string[] = []
    const fetcher = stubFetcher('fake', pages, (url) => {
      fetched.push(url)
    })
    const audit = await newAudit(brand.id)
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)

    const html = fetched.filter((u) => !/\/(robots\.txt|llms\.txt|sitemap\.xml)$/.test(u))
    expect(html.filter((u) => u === `${origin}/`)).toHaveLength(1)
    expect(html.length).toBeLessThanOrEqual(MAX_AUDIT_PAGES)
    const [top] = await pagesOf(audit.id)
    expect(top).toMatchObject({ url: `${origin}/`, status: 'fetched', httpStatus: 200 })
    expect(top?.facts).toMatchObject({ title: 'トップ' })
  })

  it('診断を作ったあとにブランドのドメインが変わったら、古いドメインは読まずに理由付きで終える', async () => {
    const { brand } = await seedBrand()
    const fetched: string[] = []
    const deps: SiteAuditDeps = {
      db,
      modeFor: allowLive,
      fetcherFor: (_mode, target) => {
        const fake = createFakeSiteFetcher(target)
        return {
          mode: fake.mode,
          fetch: (url, options) => {
            fetched.push(url)
            return fake.fetch(url, options)
          },
        }
      },
    }
    const audit = await newAudit(brand.id)
    await prepareOrFail(deps, audit.id)
    fetched.length = 0
    await db.update(brandTable).set({ domain: 'other.example' }).where(eq(brandTable.id, brand.id))

    expect((await auditPagesSlice(deps, audit.id, { budgetMs: 0 })).remaining).toBe(0)
    expect(fetched).toEqual([])
    expect(await statusOf(audit.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('ドメイン'),
    })
  })

  it('診断を作ったあとにブランドのドメインが消えたら、何も読まずに理由付きで終える', async () => {
    const { brand } = await seedBrand()
    const fetched: string[] = []
    const fetcher = stubFetcher('fake', {}, (url) => {
      fetched.push(url)
    })
    const audit = await newAudit(brand.id)
    await db.update(brandTable).set({ domain: null }).where(eq(brandTable.id, brand.id))
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)
    expect(fetched).toEqual([])
    expect(await statusOf(audit.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('ドメイン'),
    })
  })

  it('サイトに届かない（名前解決ができない）ときは、理由付きで診断を失敗にする', async () => {
    const { brand } = await seedBrand()
    const fetcher = stubFetcher('fake', {
      [`https://${DOMAIN}/robots.txt`]: new SiteFetchError('dns'),
    })
    const audit = await newAudit(brand.id)
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)
    const row = await statusOf(audit.id)
    expect(row?.status).toBe('failed')
    expect(row?.error).toContain('ドメインの名前解決ができませんでした')
  })

  it('外へのリダイレクトなどで読めなかったページは、理由付きで要対応にする', async () => {
    const { brand } = await seedBrand()
    const fetcher = stubFetcher('fake', {
      [`https://${DOMAIN}/robots.txt`]: { body: '' },
      [`https://${DOMAIN}/`]: new SiteFetchError('outside_site'),
    })
    const audit = await newAudit(brand.id)
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: allowLive }, audit.id)
    const [top] = await pagesOf(audit.id)
    expect(top).toMatchObject({ status: 'failed', error: expect.stringContaining('外') })
    const [check] = await db.select().from(siteAuditCheck).where(eq(siteAuditCheck.pageId, top!.id))
    expect(check).toMatchObject({ key: 'fetch', status: 'critical' })
  })

  it('本物のサイトは同時に 2 ページまで、間を空けて読む', async () => {
    const { brand } = await seedBrand()
    const origin = `https://${DOMAIN}`
    const paths = Array.from({ length: 5 }, (_, i) => `${origin}/p/${i}`)
    let inFlight = 0
    let maxInFlight = 0
    const sleeps: number[] = []
    const fetcher = stubFetcher(
      'live',
      {
        [`${origin}/robots.txt`]: { body: '' },
        [`${origin}/sitemap.xml`]: {
          body: `<urlset>${paths.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`,
        },
        ...Object.fromEntries(paths.map((u) => [u, { body: '<p>x</p>' }])),
      },
      async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
      },
    )
    const audit = await newAudit(brand.id, 'live')
    await executeSiteAudit(
      {
        db,
        fetcherFor: () => fetcher,
        modeFor: allowLive,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
      audit.id,
    )
    expect(maxInFlight).toBeLessThanOrEqual(2)
    // トップページ + 5 ページ = 6 ページを 2 ページずつ 3 回。2 回目と 3 回目の前に待つ
    expect(sleeps).toEqual([LIVE_REQUEST_INTERVAL_MS, LIVE_REQUEST_INTERVAL_MS])
  })

  it('本物のサイトを読む許可が、診断を作ったあとになくなったら、読まずに理由付きで失敗にする', async () => {
    const { brand } = await seedBrand()
    const fetched: string[] = []
    const fetcher = stubFetcher('live', {}, (url) => {
      fetched.push(url)
    })
    const audit = await newAudit(brand.id, 'live')
    await executeSiteAudit({ db, fetcherFor: () => fetcher, modeFor: () => 'fake' }, audit.id)
    expect(fetched).toEqual([])
    expect(await statusOf(audit.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('許可'),
    })
  })

  it('ページを読む途中で止まっても、次は読んでいないページから続ける', async () => {
    const { brand } = await seedBrand()
    const audit = await newAudit(brand.id)
    const deps = fakeDeps()
    await prepareOrFail(deps, audit.id)
    const first = await auditPagesSlice(deps, audit.id, { budgetMs: 0 })
    expect(first.remaining).toBeGreaterThan(0)
    const done = await auditPagesSlice(deps, audit.id, { budgetMs: Number.POSITIVE_INFINITY })
    expect(done.remaining).toBe(0)
    // ページごとの項目は二重に入っていない（一意制約）
    const pages = await pagesOf(audit.id)
    expect(pages.filter((p) => p.status === 'pending')).toHaveLength(0)
  })
})

describe('サイト診断の作成', () => {
  it('「今すぐ診断」は 1 ブランド 1 日 1 回まで。次の日はまた作れる', async () => {
    const { brand } = await seedBrand()
    const audit = await newAudit(brand.id)
    await executeSiteAudit(fakeDeps(), audit.id)
    await expect(newAudit(brand.id)).rejects.toBeInstanceOf(SiteAuditDailyLimitError)
    await expect(newAudit(brand.id, 'fake', '2026-11-24')).resolves.toMatchObject({
      trigger: 'manual',
    })
  })

  it('診断が動いている間は、新しく作らない', async () => {
    const { brand } = await seedBrand()
    await db.insert(siteAudit).values({
      brandId: brand.id,
      trigger: 'scheduled',
      mode: 'fake',
      requestedOn: DATE,
      domain: DOMAIN,
      status: 'running',
    })
    await expect(newAudit(brand.id)).rejects.toBeInstanceOf(SiteAuditAlreadyActiveError)
  })

  it('週 1 回の自動の診断は、ドメインがあり自動計測がオンのブランドだけ。デモ組織は除き、何度呼んでも 1 つ', async () => {
    const { brand: target } = await seedBrand()
    const { brand: noDomain } = await seedBrand()
    await db.update(brandTable).set({ domain: null }).where(eq(brandTable.id, noDomain.id))
    const { brand: off } = await seedBrand()
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, off.id))
    const { brand: demo } = await seedBrand()
    await db
      .update(organization)
      .set({ metadata: JSON.stringify({ demo: true }) })
      .where(eq(organization.id, demo.organizationId))

    const date = '2026-11-30'
    const modeFor = (): SiteMode => 'fake'
    const first = await createScheduledSiteAudits(db, date, modeFor)
    const again = await createScheduledSiteAudits(db, date, modeFor)

    const created = await db.select().from(siteAudit).where(eq(siteAudit.requestedOn, date))
    const brandIds = created.map((a) => a.brandId)
    expect(brandIds).toContain(target.id)
    expect(brandIds).not.toContain(noDomain.id)
    expect(brandIds).not.toContain(off.id)
    expect(brandIds).not.toContain(demo.id)
    expect(again.created).toBe(0)
    // 渡しそびれた queued の診断は、2 回目でも拾い直す
    expect(again.toDispatch).toEqual(first.toDispatch)
    expect(first.toDispatch).toContain(created.find((a) => a.brandId === target.id)?.id)
  })
})

describe('止まった診断の回収', () => {
  it('一定時間なにも進んでいない診断を、理由付きで失敗にする', async () => {
    const { brand } = await seedBrand()
    const audit = await newAudit(brand.id)
    expect(await recoverStaleSiteAudits(db, { staleAfterMinutes: 120 })).toBe(0)
    const later = new Date(Date.now() + 121 * 60_000)
    // ほかのテストで残した queued の診断も回収される
    expect(
      await recoverStaleSiteAudits(db, { staleAfterMinutes: 120, now: later }),
    ).toBeGreaterThan(0)
    expect(await statusOf(audit.id)).toMatchObject({ status: 'failed', error: expect.any(String) })
  })
})
