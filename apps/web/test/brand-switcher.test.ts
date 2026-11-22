import { brand as brandTable, organization, run } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { DEMO_METADATA } from '@/server/demo'
import { listBrandsInOrganization, resolveHomeBrandId } from '@/server/queries/brands'
import { TestClient } from './helpers'

async function setup(name = 'hana') {
  const client = new TestClient()
  await client.signUp(name)
  const org = await client.createOrganization(`${name} Inc`)
  const { json } = await client.post('/api/brands', {
    name: '1社目',
    prompts: ['おすすめの会計ソフトは？'],
    samplesPerPrompt: 1,
  })
  return { client, organizationId: org.json.id as string, first: json.brand }
}

const secondBrand = {
  name: '2社目',
  aliases: ['ニシャメ', 'Second'],
  competitors: [{ name: '競合X' }],
  prompts: [
    { text: 'おすすめの経費精算アプリは？', kind: 'question' },
    { text: '経費精算 アプリ 比較', kind: 'keyword' },
  ],
}

describe('ブランドの追加', () => {
  it('2 社目を追加すると、別名・競合・質問の種類つきで保存され、組織のブランドの一覧に入る', async () => {
    const { client, organizationId, first } = await setup()

    const created = await client.post('/api/brands', secondBrand)
    expect(created.status).toBe(201)
    const added = created.json.brand
    expect(added).toMatchObject({ name: '2社目', aliases: ['ニシャメ', 'Second'] })
    expect(added.competitors.map((c: { name: string }) => c.name)).toEqual(['競合X'])
    expect(added.prompts.map((p: { text: string; kind: string }) => [p.text, p.kind])).toEqual([
      ['おすすめの経費精算アプリは？', 'question'],
      ['経費精算 アプリ 比較', 'keyword'],
    ])

    const brands = await listBrandsInOrganization(organizationId)
    expect(brands.map((b) => b.id)).toEqual([first.id, added.id])
  })

  it('質問は文字列でも渡せる（種類は質問文になる）。文字列と種類つきで同じ文面なら 400', async () => {
    const { client } = await setup()
    const plain = await client.post('/api/brands', { name: '3社目', prompts: ['質問A'] })
    expect(plain.json.brand.prompts[0]).toMatchObject({ text: '質問A', kind: 'question' })

    const dup = await client.post('/api/brands', {
      name: '4社目',
      prompts: ['質問B', { text: '質問B', kind: 'keyword' }],
    })
    expect(dup.status).toBe(400)
    expect(dup.json.error.issues[0].path).toEqual(['prompts'])
  })

  it('デモの組織では追加できない（403）', async () => {
    const { client, organizationId } = await setup('demo-add')
    await db
      .update(organization)
      .set({ metadata: DEMO_METADATA })
      .where(eq(organization.id, organizationId))

    const res = await client.post('/api/brands', secondBrand)
    expect(res.status).toBe(403)
    expect(res.json.error.code).toBe('DEMO_READ_ONLY')
    expect(await listBrandsInOrganization(organizationId)).toHaveLength(1)
  })
})

describe('/app で移動するブランド（resolveHomeBrandId）', () => {
  it('覚えているブランド（Cookie）が組織のものなら、そのブランド', async () => {
    const { client, organizationId } = await setup('jiro')
    const second = (await client.post('/api/brands', secondBrand)).json.brand
    expect(await resolveHomeBrandId(organizationId, second.id)).toBe(second.id)
  })

  it('覚えているブランドがない・壊れている・他の組織のものなら、最初に登録したブランド', async () => {
    const a = await setup('kenta')
    const b = await setup('saburo')
    await a.client.post('/api/brands', secondBrand)

    expect(await resolveHomeBrandId(a.organizationId, undefined)).toBe(a.first.id)
    expect(await resolveHomeBrandId(a.organizationId, 'not-a-uuid')).toBe(a.first.id)
    expect(await resolveHomeBrandId(a.organizationId, b.first.id)).toBe(a.first.id)
  })

  it('ブランドがない組織では null', async () => {
    const client = new TestClient()
    await client.signUp('nobrand')
    const org = await client.createOrganization('NoBrand Inc')
    expect(await resolveHomeBrandId(org.json.id, undefined)).toBeNull()
  })

  it('ブランドの一覧に、他の組織のブランドは入らない', async () => {
    const a = await setup('taro')
    await setup('hanako')
    const brands = await listBrandsInOrganization(a.organizationId)
    expect(brands).toEqual([{ id: a.first.id, name: '1社目' }])
  })
})

describe('自動計測のオン／オフ', () => {
  it('オフにできて、オフでも「今すぐ計測」は使える', async () => {
    const { client, first } = await setup()

    const off = await client.request('PATCH', `/api/brands/${first.id}`, {
      scheduleEnabled: false,
    })
    expect(off.status).toBe(200)
    expect(off.json.brand.scheduleEnabled).toBe(false)

    const started = await client.post(`/api/brands/${first.id}/runs`, {})
    expect(started.status).toBe(202)
    const runs = await db.select().from(run).where(eq(run.brandId, first.id))
    expect(runs).toHaveLength(1)
  })

  it('取り消した自動 run は、計測の履歴に状態と理由つきで出て、手動の計測を止めない', async () => {
    const { client, first } = await setup()
    await db.insert(run).values({
      brandId: first.id,
      trigger: 'scheduled',
      scheduledFor: '2031-01-01',
      status: 'cancelled',
      cancelReason: 'schedule_disabled',
      finishedAt: new Date(),
    })

    const list = await client.get(`/api/brands/${first.id}/runs`)
    expect(list.json.runs[0]).toMatchObject({
      status: 'cancelled',
      cancelReason: 'schedule_disabled',
    })
    expect((await client.post(`/api/brands/${first.id}/runs`, {})).status).toBe(202)
  })

  it('新しく追加したブランドは、自動計測がオンになっている', async () => {
    const { first } = await setup()
    const [row] = await db
      .select({ scheduleEnabled: brandTable.scheduleEnabled })
      .from(brandTable)
      .where(eq(brandTable.id, first.id))
    expect(row?.scheduleEnabled).toBe(true)
  })

  it('他の組織のブランドの自動計測は変えられない（404）', async () => {
    const a = await setup('umeko')
    const b = await setup('takeko')
    const res = await a.client.request('PATCH', `/api/brands/${b.first.id}`, {
      scheduleEnabled: false,
    })
    expect(res.status).toBe(404)
    const [row] = await db
      .select({ scheduleEnabled: brandTable.scheduleEnabled })
      .from(brandTable)
      .where(eq(brandTable.id, b.first.id))
    expect(row?.scheduleEnabled).toBe(true)
  })
})
