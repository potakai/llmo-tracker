import { analysis, prompt, response } from '@llmo/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { getBrandMetrics } from '@/server/queries/metrics'
import { TestClient } from './helpers'

async function setup(name = 'gina') {
  const client = new TestClient()
  await client.signUp(name)
  const org = await client.createOrganization(`${name} Inc`)
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    prompts: ['おすすめの会計ソフトは？', '会計ソフト 安い', '会計ソフト 比較'],
    samplesPerPrompt: 2,
  })
  return { client, organizationId: org.json.id as string, brand: json.brand }
}

const promptPath = (brandId: string, promptId: string) =>
  `/api/brands/${brandId}/prompts/${promptId}`

describe('質問の種類の初期値', () => {
  it('種類を指定せずに登録・追加すると、質問文（question）になる', async () => {
    const { client, brand } = await setup()
    expect(brand.prompts.map((p: { kind: string }) => p.kind)).toEqual([
      'question',
      'question',
      'question',
    ])

    const added = await client.post(`/api/brands/${brand.id}/prompts`, { text: '追加した質問' })
    expect(added.json.prompt.kind).toBe('question')
  })

  it('種類の列がなかったころの質問（種類を入れずに作った行）は、質問文（question）になる', async () => {
    const { brand } = await setup()
    // migration で列を足したときの既存の行と同じく、kind を指定せずに入れる
    const rows = await db.execute<{ kind: string }>(
      sql`insert into prompt (id, brand_id, text) values (gen_random_uuid(), ${brand.id}, '昔の質問') returning kind`,
    )
    expect(rows[0]?.kind).toBe('question')
  })
})

describe('質問の種類の追加・変更', () => {
  it('キーワードとして追加でき、あとから種類を変えられる', async () => {
    const { client, brand } = await setup()
    const added = await client.post(`/api/brands/${brand.id}/prompts`, {
      text: '会計ソフト おすすめ',
      kind: 'keyword',
    })
    expect(added.status).toBe(201)
    expect(added.json.prompt.kind).toBe('keyword')

    const changed = await client.request('PATCH', promptPath(brand.id, added.json.prompt.id), {
      kind: 'question',
    })
    expect(changed.status).toBe(200)
    expect(changed.json.prompt).toMatchObject({ kind: 'question', text: '会計ソフト おすすめ' })
  })

  it('知らない種類や、文面の変更は 400', async () => {
    const { client, brand } = await setup()
    const id = brand.prompts[0].id
    const bad = await client.request('PATCH', promptPath(brand.id, id), { kind: 'sentence' })
    expect(bad.status).toBe(400)
    const text = await client.request('PATCH', promptPath(brand.id, id), { text: '書き換え' })
    expect(text.status).toBe(400)
  })

  it('他の組織の質問の種類は変えられない（404）', async () => {
    const mine = await setup('hana')
    const other = await setup('ivan')
    const otherPromptId = other.brand.prompts[0].id

    // 自分のブランドの URL に、他の組織の質問 ID を入れても 404
    const viaMyBrand = await mine.client.request(
      'PATCH',
      promptPath(mine.brand.id, otherPromptId),
      {
        kind: 'keyword',
      },
    )
    expect(viaMyBrand.status).toBe(404)
    // 他の組織のブランドの URL でも 404（403 にして存在を漏らさない）
    const viaOtherBrand = await mine.client.request(
      'PATCH',
      promptPath(other.brand.id, otherPromptId),
      { kind: 'keyword' },
    )
    expect(viaOtherBrand.status).toBe(404)

    const [row] = await db.select().from(prompt).where(eq(prompt.id, otherPromptId))
    expect(row?.kind).toBe('question')
  })
})

describe('種類ごとの集計', () => {
  /**
   * 質問文 1 つ・キーワード 2 つで 1 回計測し、言及の有無を決め打ちにする。
   * - 質問文：すべての回答で言及あり（2 AI × 2 回 = 4 件中 4 件）
   * - キーワード 1 つ目：ChatGPT の回答だけ言及あり（2 件）
   * - キーワード 2 つ目：言及なし
   * → キーワードは 8 件中 2 件
   */
  async function measured() {
    const s = await setup()
    const [questionId, keywordId, keyword2Id] = s.brand.prompts.map((p: { id: string }) => p.id)
    for (const id of [keywordId, keyword2Id]) {
      await s.client.request('PATCH', promptPath(s.brand.id, id), { kind: 'keyword' })
    }
    await s.client.post(`/api/brands/${s.brand.id}/runs`, {})

    const responseIds = (where: ReturnType<typeof and>) =>
      db.select({ id: response.id }).from(response).where(where)
    await db
      .update(analysis)
      .set({ brandMentioned: false })
      .where(
        inArray(
          analysis.responseId,
          responseIds(
            inArray(
              response.promptId,
              s.brand.prompts.map((p: { id: string }) => p.id),
            ),
          ),
        ),
      )
    await db
      .update(analysis)
      .set({ brandMentioned: true })
      .where(inArray(analysis.responseId, responseIds(eq(response.promptId, questionId))))
    await db
      .update(analysis)
      .set({ brandMentioned: true })
      .where(
        inArray(
          analysis.responseId,
          responseIds(and(eq(response.promptId, keywordId), eq(response.provider, 'openai'))),
        ),
      )
    return { ...s, questionId, keywordId, keyword2Id }
  }

  it('種類ごとの言及率が、その種類の質問への回答だけから出る', async () => {
    const { organizationId, brand } = await measured()

    const metrics = await getBrandMetrics(organizationId, brand.id, 'fake', { days: 7 })
    expect(metrics.byKind).toEqual([
      expect.objectContaining({ kind: 'question', n: 4, rate: 1 }),
      expect.objectContaining({ kind: 'keyword', n: 8, rate: 0.25 }),
    ])
    expect(metrics.byPrompt.map((p) => p.kind)).toEqual(['question', 'keyword', 'keyword'])
  })

  it('種類で絞り込むと、ほかの数字はその種類だけになり、種類ごとの比較は両方とも残る', async () => {
    const { client, brand } = await measured()

    const res = await client.get(`/api/brands/${brand.id}/metrics?days=7&kind=keyword`)
    expect(res.status).toBe(200)
    const metrics = res.json.metrics
    expect(metrics.latest).toMatchObject({ n: 8, rate: 0.25 })
    expect(metrics.byPrompt).toHaveLength(2)
    expect(metrics.filter.kind).toBe('keyword')
    expect(metrics.byKind.map((k: { n: number }) => k.n)).toEqual([4, 8])
  })

  it('AI で絞り込むと、種類ごとの比較もその AI の回答だけになる', async () => {
    const { organizationId, brand } = await measured()

    const metrics = await getBrandMetrics(organizationId, brand.id, 'fake', {
      days: 7,
      provider: 'openai',
    })
    expect(metrics.byKind).toEqual([
      expect.objectContaining({ kind: 'question', n: 2, rate: 1 }),
      expect.objectContaining({ kind: 'keyword', n: 4, rate: 0.5 }),
    ])
  })

  it('知らない種類で絞り込むと 400', async () => {
    const { client, brand } = await setup()
    const res = await client.get(`/api/brands/${brand.id}/metrics?kind=sentence`)
    expect(res.status).toBe(400)
  })
})
