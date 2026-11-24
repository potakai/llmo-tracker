import { organization, siteAudit, siteAuditCheck } from '@llmo/db'
import { executeSiteAudit } from '@llmo/runner'
import { createFakeSiteFetcher } from '@llmo/site'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { createApp } from '@/server/app'
import { DEMO_METADATA } from '@/server/demo'
import { getSiteAuditOverview, getSiteAuditPageDetail } from '@/server/queries/site-audit'
import { TestClient } from './helpers'

async function setup(name: string, options: { domain?: string } = { domain: 'maru.example.com' }) {
  const client = new TestClient()
  await client.signUp(name)
  const org = await client.createOrganization(`${name} Inc`)
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    ...(options.domain ? { domain: options.domain } : {}),
    prompts: ['質問'],
  })
  return { client, brandId: json.brand.id as string, organizationId: org.json.id as string }
}

const startAudit = (client: TestClient, brandId: string) =>
  client.post(`/api/brands/${brandId}/site-audits`, {})

describe('今すぐ診断', () => {
  it('押すと診断が動き、サイト全体の項目が要対応から並ぶ。同じ日にもう一度押すと 429', async () => {
    const { client, brandId, organizationId } = await setup('ada')

    const res = await startAudit(client, brandId)
    expect(res.status).toBe(202)

    const overview = await getSiteAuditOverview(organizationId, brandId)
    expect(overview.current?.status).toBe('succeeded')
    expect(overview.manualUsedToday).toBe(true)
    const statuses = overview.siteChecks.map((c) => c.status)
    expect(statuses).toEqual([...statuses].sort((a, b) => rank(a) - rank(b)))
    expect(overview.pages[0]?.url).toBe('https://maru.example.com/')
    expect(overview.pages.find((p) => p.url.endsWith('/blog/cloud'))?.critical).toBeGreaterThan(0)

    const again = await startAudit(client, brandId)
    expect(again.status).toBe(429)
    expect(again.json.error.code).toBe('SITE_AUDIT_DAILY_LIMIT')
  })

  it('ドメインが登録されていなければ 400', async () => {
    const { client, brandId } = await setup('bob', {})
    const res = await startAudit(client, brandId)
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('NO_DOMAIN')
  })

  it('他の組織のブランドは 404。診断の結果もページの詳細も見えない', async () => {
    const owner = await setup('carol')
    await startAudit(owner.client, owner.brandId)
    const other = await setup('dave')

    const res = await startAudit(other.client, owner.brandId)
    expect(res.status).toBe(404)

    const ownerView = await getSiteAuditOverview(owner.organizationId, owner.brandId)
    const pageId = ownerView.pages[0]!.id
    expect(await getSiteAuditPageDetail(owner.organizationId, owner.brandId, pageId)).not.toBeNull()
    expect(await getSiteAuditPageDetail(other.organizationId, owner.brandId, pageId)).toBeNull()
    // 他の組織の自分のブランドの ID を使っても、そのページは見えない
    expect(await getSiteAuditPageDetail(other.organizationId, other.brandId, pageId)).toBeNull()
    expect((await getSiteAuditOverview(other.organizationId, owner.brandId)).current).toBeNull()
  })

  it('ページの詳細の項目は、そのページの診断のもので、自分の組織のものだけを読む', async () => {
    const owner = await setup('ivan')
    await startAudit(owner.client, owner.brandId)
    const other = await setup('judy')
    await startAudit(other.client, other.brandId)
    const ownerView = await getSiteAuditOverview(owner.organizationId, owner.brandId)
    const otherView = await getSiteAuditOverview(other.organizationId, other.brandId)
    const page = ownerView.pages[0]!
    // 食い違った行：ページは自分のものだが、診断 ID は他の組織の診断を指している
    await db.insert(siteAuditCheck).values({
      auditId: otherView.current!.id,
      pageId: page.id,
      key: 'leaked',
      status: 'critical',
      message: '他の組織の項目',
    })
    const detail = await getSiteAuditPageDetail(owner.organizationId, owner.brandId, page.id)
    expect(detail?.checks.map((c) => c.key)).not.toContain('leaked')
    expect(detail?.checks.length).toBeGreaterThan(0)
  })

  it('同時に 2 回送ると、成功 1 件・429 1 件で、ジョブに渡すのは 1 回だけ', async () => {
    const dispatched: string[] = []
    const counting = createApp({
      dispatchRun: () => {},
      dispatchSiteAudit: (auditId) => {
        dispatched.push(auditId)
      },
    })
    const client = new TestClient(counting)
    await client.signUp('kim')
    await client.createOrganization('Kim Inc')
    const { json } = await client.post('/api/brands', {
      name: '◯◯会計',
      domain: 'maru.example.com',
      prompts: ['質問'],
    })

    const results = await Promise.all([
      startAudit(client, json.brand.id),
      startAudit(client, json.brand.id),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([202, 429])
    expect(dispatched).toHaveLength(1)
  })

  it('デモ組織では 403', async () => {
    const { client, brandId, organizationId } = await setup('erin')
    await db
      .update(organization)
      .set({ metadata: DEMO_METADATA })
      .where(eq(organization.id, organizationId))
    const res = await startAudit(client, brandId)
    expect(res.status).toBe(403)
    expect(res.json.error.code).toBe('DEMO_READ_ONLY')
  })

  it('ジョブに渡せなかったら 503 を返して診断を消し、同じ日にもう一度押せる', async () => {
    let fail = true
    const flaky = createApp({
      dispatchRun: () => {},
      dispatchSiteAudit: async (auditId) => {
        if (fail) throw new Error('Inngest に接続できません')
        const { runSiteAuditNow } = await import('./helpers')
        await runSiteAuditNow(auditId)
      },
    })
    const client = new TestClient(flaky)
    await client.signUp('frank')
    await client.createOrganization('Frank Inc')
    const { json } = await client.post('/api/brands', {
      name: '◯◯会計',
      domain: 'maru.example.com',
      prompts: ['質問'],
    })

    const res = await startAudit(client, json.brand.id)
    expect(res.status).toBe(503)
    expect(res.json.error.code).toBe('DISPATCH_FAILED')
    const rows = await db.select().from(siteAudit).where(eq(siteAudit.brandId, json.brand.id))
    expect(rows).toHaveLength(0)

    fail = false
    expect((await startAudit(client, json.brand.id)).status).toBe(202)
  })
})

describe('前回の診断からの変化', () => {
  it('前回より直った項目と、新しく出た項目を出す', async () => {
    const { client, brandId, organizationId } = await setup('grace')
    await startAudit(client, brandId)
    // 先週の診断（サイトの版が古い）を、今日の診断より前に作ったことにする
    const [old] = await db
      .insert(siteAudit)
      .values({
        brandId,
        trigger: 'scheduled',
        mode: 'fake',
        requestedOn: '2026-01-05',
        domain: 'maru.example.com',
        createdAt: new Date('2026-01-05T00:00:00Z'),
      })
      .returning()
    await executeSiteAudit(
      {
        db,
        fetcherFor: (_m, target) => createFakeSiteFetcher({ ...target, revision: 0 }),
        modeFor: () => 'fake',
      },
      old!.id,
    )

    const overview = await getSiteAuditOverview(organizationId, brandId)
    expect(overview.previous?.id).toBe(old!.id)
    const short = (list: { pageUrl: string | null; key: string }[]) =>
      list.map((c) => `${c.pageUrl?.replace('https://maru.example.com', '') ?? 'site'}:${c.key}`)
    expect(short(overview.changes!.fixed)).toEqual(['/features:meta_description'])
    expect(short(overview.changes!.appeared)).toEqual(['/blog/invoice:structured_data'])
  })
})

const rank = (status: string) => ['critical', 'warning', 'ok'].indexOf(status)
