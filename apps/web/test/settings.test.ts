import { organization } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { DEMO_METADATA } from '@/server/demo'
import { TestClient } from './helpers'

async function setup() {
  const client = new TestClient()
  await client.signUp('frank')
  const org = await client.createOrganization('Frank Inc')
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    competitors: [{ name: '競合A' }],
    prompts: ['質問1', '質問2'],
  })
  return { client, organizationId: org.json.id as string, brand: json.brand }
}

describe('ブランド情報の変更', () => {
  it('送った項目だけが変わる', async () => {
    const { client, brand } = await setup()
    const res = await client.request('PATCH', `/api/brands/${brand.id}`, {
      samplesPerPrompt: 3,
      domain: 'https://www.maru.example.com/',
    })
    expect(res.status).toBe(200)
    expect(res.json.brand).toMatchObject({
      name: '◯◯会計',
      samplesPerPrompt: 3,
      domain: 'maru.example.com',
    })
  })

  it('空の変更や範囲外の値は 400', async () => {
    const { client, brand } = await setup()
    expect((await client.request('PATCH', `/api/brands/${brand.id}`, {})).status).toBe(400)
    expect(
      (await client.request('PATCH', `/api/brands/${brand.id}`, { samplesPerPrompt: 0 })).status,
    ).toBe(400)
  })
})

describe('競合の編集', () => {
  it('追加・名前の変更・削除ができ、同じ名前は 409', async () => {
    const { client, brand } = await setup()
    const added = await client.post(`/api/brands/${brand.id}/competitors`, { name: '競合B' })
    expect(added.status).toBe(201)

    const dup = await client.post(`/api/brands/${brand.id}/competitors`, { name: '競合B' })
    expect(dup.status).toBe(409)

    const id = added.json.competitor.id
    const renamed = await client.request('PATCH', `/api/brands/${brand.id}/competitors/${id}`, {
      name: '競合B（新社名）',
    })
    expect(renamed.json.competitor.name).toBe('競合B（新社名）')

    const removed = await client.request('DELETE', `/api/brands/${brand.id}/competitors/${id}`)
    expect(removed.status).toBe(204)
    const detail = await client.get(`/api/brands/${brand.id}`)
    expect(detail.json.brand.competitors.map((c: { name: string }) => c.name)).toEqual(['競合A'])
  })

  it('他のブランドの競合 ID は 404', async () => {
    const a = await setup()
    const b = await setup()
    const otherId = b.brand.competitors[0].id
    const res = await a.client.request('DELETE', `/api/brands/${a.brand.id}/competitors/${otherId}`)
    expect(res.status).toBe(404)
  })
})

describe('質問の追加・アーカイブ・復元', () => {
  it('有効な質問は 10 個まで。アーカイブすると枠が空き、復元でまた埋まる', async () => {
    const { client, brand } = await setup()
    for (let i = 3; i <= 10; i++) {
      const res = await client.post(`/api/brands/${brand.id}/prompts`, { text: `質問${i}` })
      expect(res.status).toBe(201)
    }
    const over = await client.post(`/api/brands/${brand.id}/prompts`, { text: '質問11' })
    expect(over.status).toBe(400)
    expect(over.json.error.code).toBe('PROMPT_LIMIT')

    const first = brand.prompts[0].id
    const archived = await client.post(`/api/brands/${brand.id}/prompts/${first}/archive`, {})
    expect(archived.json.prompt.archivedAt).not.toBeNull()
    expect((await client.post(`/api/brands/${brand.id}/prompts`, { text: '質問11' })).status).toBe(
      201,
    )

    // 10 個埋まっているので、復元はできない
    const restore = await client.post(`/api/brands/${brand.id}/prompts/${first}/restore`, {})
    expect(restore.json.error.code).toBe('PROMPT_LIMIT')
  })

  it('同時に追加しても 10 個を超えない', async () => {
    const { client, brand } = await setup()
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        client.post(`/api/brands/${brand.id}/prompts`, { text: `同時${i}` }),
      ),
    )
    expect(results.filter((r) => r.status === 201)).toHaveLength(8) // 最初の 2 個＋8 個 = 10
    const detail = await client.get(`/api/brands/${brand.id}`)
    expect(detail.json.brand.prompts).toHaveLength(10)
  })

  it('有効な質問と同じ文面は 409', async () => {
    const { client, brand } = await setup()
    const res = await client.post(`/api/brands/${brand.id}/prompts`, { text: '質問1' })
    expect(res.status).toBe(409)
  })
})

describe('デモ組織は閲覧専用', () => {
  async function demoSetup() {
    const s = await setup()
    await db
      .update(organization)
      .set({ metadata: DEMO_METADATA })
      .where(eq(organization.id, s.organizationId))
    return s
  }

  it('見ることはできる', async () => {
    const { client, brand } = await demoSetup()
    expect((await client.get(`/api/brands/${brand.id}`)).status).toBe(200)
    expect((await client.get(`/api/brands/${brand.id}/metrics`)).status).toBe(200)
  })

  it('計測・編集・追加はすべて 403', async () => {
    const { client, brand } = await demoSetup()
    const attempts = [
      client.post(`/api/brands/${brand.id}/runs`, {}),
      client.request('PATCH', `/api/brands/${brand.id}`, { name: '乗っ取り' }),
      client.post(`/api/brands/${brand.id}/prompts`, { text: '新しい質問' }),
      client.post('/api/brands', { name: '別ブランド', prompts: ['質問'] }),
    ]
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403)
      expect(res.json.error.code).toBe('DEMO_READ_ONLY')
    }
  })

  it('組織の作成やパスワード変更（Better Auth 側）もできない。ログアウトはできる', async () => {
    const { client } = await demoSetup()
    expect((await client.createOrganization('抜け道')).status).toBe(403)
    const change = await client.post('/api/auth/change-password', {
      currentPassword: 'password-1234',
      newPassword: 'hacked-password-1',
    })
    expect(change.status).toBe(403)
    expect((await client.post('/api/auth/sign-out', {})).status).toBe(200)
  })
})

describe('ダッシュボードの絞り込み', () => {
  it('AI と質問で絞り込むと、回答数がその分だけになる', async () => {
    const { client, brand } = await setup()
    await client.post(`/api/brands/${brand.id}/runs`, {})
    const all = await client.get(`/api/brands/${brand.id}/metrics?days=7`)
    // 2 質問 × 2 AI × 5 回 = 20
    expect(all.json.metrics.latest.n).toBe(20)
    expect(all.json.metrics.byPrompt).toHaveLength(2)

    const openai = await client.get(`/api/brands/${brand.id}/metrics?days=7&ai=openai`)
    expect(openai.json.metrics.latest.n).toBe(10)

    const q = brand.prompts[0].id
    const one = await client.get(`/api/brands/${brand.id}/metrics?days=7&ai=gemini&q=${q}`)
    expect(one.json.metrics.latest.n).toBe(5)
    expect(one.json.metrics.byPrompt).toHaveLength(1)
  })

  it('期間は 7・30・90 日のどれか', async () => {
    const { client, brand } = await setup()
    expect((await client.get(`/api/brands/${brand.id}/metrics?days=14`)).status).toBe(400)
  })
})
