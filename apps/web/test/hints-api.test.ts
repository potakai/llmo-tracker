import { analysis, brand as brandTable, prompt, response, run } from '@llmo/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { HINT_WINDOW_DAYS, MIN_RESPONSES } from '@/lib/hints'
import { addDays, todayInTokyo } from '@/lib/stats'
import { listEvidenceResponses, loadHintResponses } from '@/server/queries/hints'
import { TestClient } from './helpers'

/** 3 つの質問 × 2 AI × 10 回 = 60 件（MIN_RESPONSES 以上）を 1 回で集めるブランド */
async function setup(
  name = 'hint',
  options: { samplesPerPrompt?: number; prompts?: string[] } = {},
) {
  const client = new TestClient()
  await client.signUp(name)
  const org = await client.createOrganization(`${name} Inc`)
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    domain: 'own.example',
    competitors: [{ name: '競合A' }, { name: '競合B' }],
    prompts: options.prompts ?? ['おすすめの会計ソフトは？', '会計ソフト 安い', '会計ソフト 比較'],
    samplesPerPrompt: options.samplesPerPrompt ?? 10,
  })
  await client.post(`/api/brands/${json.brand.id}/runs`, {})
  return { client, organizationId: org.json.id as string, brand: json.brand }
}

const since = () => addDays(todayInTokyo(), -(HINT_WINDOW_DAYS - 1))
const hintsPath = (brandId: string) => `/api/brands/${brandId}/hints`

describe('改善のヒントの API', () => {
  it(`回答が ${MIN_RESPONSES} 件以上あれば、施策の一覧と根拠の回答を返す`, async () => {
    const { client, brand } = await setup()

    const res = await client.get(hintsPath(brand.id))
    expect(res.status).toBe(200)
    expect(res.json.hints).toMatchObject({ status: 'ready', responses: 60 })
    // 施策が指している根拠の回答は、すべて evidence に入っている
    const ids = res.json.hints.hints.flatMap(
      (h: { evidenceResponseIds?: string[] }) => h.evidenceResponseIds ?? [],
    )
    const evidenceIds = res.json.evidence.map((r: { id: string }) => r.id)
    expect(evidenceIds.sort()).toEqual([...new Set(ids)].sort())
  })

  it('回答が少ないうちは施策を出さず、今の設定から、あと何日かかるかを返す', async () => {
    // 2 つの質問 × 2 AI × 1 回 = 1 日 4 件（14 日で 56 件なので届く）
    const { client, brand } = await setup('few', {
      samplesPerPrompt: 1,
      prompts: ['質問1', '質問2'],
    })

    const res = await client.get(hintsPath(brand.id))
    expect(res.status).toBe(200)
    expect(res.json.hints).toEqual({
      status: 'waiting',
      responses: 4,
      needed: MIN_RESPONSES,
      estimate: { kind: 'days', daysLeft: Math.ceil((MIN_RESPONSES - 4) / 4) },
    })
    expect(res.json.evidence).toEqual([])
  })

  it(`今の設定では ${HINT_WINDOW_DAYS} 日で ${MIN_RESPONSES} 件に届かないなら、1 日の件数とともにそう返す`, async () => {
    // 1 つの質問 × 2 AI × 1 回 = 1 日 2 件（14 日で 28 件）
    const { client, brand } = await setup('tiny', { samplesPerPrompt: 1, prompts: ['質問'] })

    const res = await client.get(hintsPath(brand.id))
    expect(res.json.hints.estimate).toEqual({ kind: 'unreachable', responsesPerDay: 2 })
  })

  it('自動計測がオフのときと、有効な質問がないときを分けて返す', async () => {
    const { client, brand } = await setup('off', { samplesPerPrompt: 1, prompts: ['質問'] })
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))
    const off = await client.get(hintsPath(brand.id))
    expect(off.json.hints.estimate).toEqual({ kind: 'scheduleOff' })

    await db.update(prompt).set({ archivedAt: new Date() }).where(eq(prompt.brandId, brand.id))
    const noPrompts = await client.get(hintsPath(brand.id))
    expect(noPrompts.json.hints.estimate).toEqual({ kind: 'noActivePrompts' })
  })

  it('他の組織のブランドは 404', async () => {
    const owner = await setup('owner')
    const other = new TestClient()
    await other.signUp('stranger')
    await other.createOrganization('Stranger Inc')

    const res = await other.get(hintsPath(owner.brand.id))
    expect(res.status).toBe(404)
    expect(res.json.error.code).toBe('NOT_FOUND')
  })

  it('否定的な回答があれば、否定的な箇所を前後の文つきで返し、特定できない回答は数を返す', async () => {
    const { client, brand } = await setup()
    const negatives = await db
      .select({ id: response.id })
      .from(response)
      .innerJoin(run, eq(run.id, response.runId))
      .innerJoin(analysis, eq(analysis.responseId, response.id))
      .where(and(eq(run.brandId, brand.id), eq(analysis.brandMentioned, true)))
      .limit(2)
    expect(negatives).toHaveLength(2)
    const ids = negatives.map((r) => r.id)
    await db
      .update(analysis)
      .set({ sentiment: 'negative' })
      .where(inArray(analysis.responseId, ids))

    // 1 件目だけ、否定的な言い回しの入った回答にする（2 件目はフェイクの AI の回答のまま）
    await db
      .update(response)
      .set({
        answerText:
          'おすすめは次のとおりです。\n1. ◯◯会計：サポートの返信が遅いという声もあります。',
      })
      .where(eq(response.id, ids[0] ?? ''))

    const res = await client.get(hintsPath(brand.id))
    const hint = res.json.hints.hints.find((h: { kind: string }) => h.kind === 'negative')
    expect(hint).toMatchObject({
      kind: 'negative',
      negativeResponses: 2,
      passages: [
        {
          before: 'おすすめは次のとおりです。',
          focus: '◯◯会計：サポートの返信が遅いという声もあります。',
          after: null,
        },
      ],
      unlocatedResponses: 1,
    })
    expect([...hint.evidenceResponseIds].sort()).toEqual([...ids].sort())
  })
})

describe('施策のもとにする回答の集め方', () => {
  it('回答ごとに、出てきた競合・引用されたドメイン・質問がそろう', async () => {
    const { organizationId, brand } = await setup()

    const rows = await loadHintResponses(organizationId, brand.id, 'fake', since())
    expect(rows).toHaveLength(60)
    const competitorIds = brand.competitors.map((c: { id: string }) => c.id)
    for (const row of rows) {
      // 手動の計測なので、計測した日（日本時間の今日）
      expect(row.date).toBe(todayInTokyo())
      expect(row.isPromptActive).toBe(true)
      expect(brand.prompts.map((p: { id: string }) => p.id)).toContain(row.promptId)
      for (const id of row.competitorIds) expect(competitorIds).toContain(id)
      // フェイクの AI は example.com を引用する（同じドメインは 1 回だけ数える）
      expect(row.citedDomains).toEqual(['example.com'])
    }
    expect(rows.some((r) => r.competitorIds.length > 0)).toBe(true)
  })

  it('アーカイブした質問への回答は、今は計測していない質問として印が付く', async () => {
    const { organizationId, brand } = await setup()
    const archivedId = brand.prompts[0].id as string
    await db.update(prompt).set({ archivedAt: new Date() }).where(eq(prompt.id, archivedId))

    const rows = await loadHintResponses(organizationId, brand.id, 'fake', since())
    expect(rows.filter((r) => !r.isPromptActive).every((r) => r.promptId === archivedId)).toBe(true)
    expect(rows.filter((r) => !r.isPromptActive)).toHaveLength(20)
  })

  it(`${HINT_WINDOW_DAYS} 日より前の回答は入れない`, async () => {
    const { organizationId, brand } = await setup()
    await db
      .update(run)
      .set({ createdAt: sql`now() - interval '${sql.raw(String(HINT_WINDOW_DAYS))} days'` })
      .where(eq(run.brandId, brand.id))

    expect(await loadHintResponses(organizationId, brand.id, 'fake', since())).toEqual([])
  })

  it('本物の AI で計測している組織では、サンプルの AI の回答を入れない', async () => {
    const { organizationId, brand } = await setup()
    expect(await loadHintResponses(organizationId, brand.id, 'live', since())).toEqual([])
  })

  it('他の組織の ID を渡すと、回答も根拠も空になる', async () => {
    const { organizationId, brand } = await setup('tenant')
    const other = new TestClient()
    await other.signUp('tenant-other')
    const otherOrg = await other.createOrganization('Other Inc')
    const otherOrgId = otherOrg.json.id as string

    const rows = await loadHintResponses(organizationId, brand.id, 'fake', since())
    const ids = rows.slice(0, 3).map((r) => r.id)
    expect(await listEvidenceResponses(organizationId, brand.id, 'fake', ids)).toHaveLength(3)

    expect(await loadHintResponses(otherOrgId, brand.id, 'fake', since())).toEqual([])
    expect(await listEvidenceResponses(otherOrgId, brand.id, 'fake', ids)).toEqual([])
  })

  it('根拠の回答は、そのブランドのものだけ返す（同じ組織の別のブランドの回答 ID を混ぜても出さない）', async () => {
    const { client, organizationId, brand } = await setup()
    const another = await client.post('/api/brands', { name: '別ブランド', prompts: ['別の質問'] })
    await client.post(`/api/brands/${another.json.brand.id}/runs`, {})
    const [foreign] = await db
      .select({ id: response.id })
      .from(response)
      .innerJoin(run, eq(run.id, response.runId))
      .where(eq(run.brandId, another.json.brand.id))
      .limit(1)

    expect(
      await listEvidenceResponses(organizationId, brand.id, 'fake', [foreign?.id ?? '']),
    ).toEqual([])
  })
})
