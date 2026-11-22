import { serpResult } from '@llmo/db'
import { createRuleBasedExtractor } from '@llmo/llm'
import { claimSerpTasks, collectSerpResults, postSerpTasks } from '@llmo/runner'
import type { FetchedTask, ParsedSerp, SerpMode, SerpProvider } from '@llmo/serp'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { todayInTokyo } from '@/lib/stats'
import { getSerpComparison } from '@/server/queries/serp'
import { TestClient } from './helpers'

/** 御社（maru.example.com）が 2 位、競合A（a.example）が 5 位で、AI による概要に御社だけが出る結果 */
const SERP: ParsedSerp = {
  organic: [
    {
      rank: 1,
      rankAbsolute: 2,
      domain: 'hikaku.example',
      url: 'https://hikaku.example/',
      title: null,
    },
    {
      rank: 2,
      rankAbsolute: 3,
      domain: 'www.maru.example.com',
      url: 'https://www.maru.example.com/',
      title: null,
    },
    { rank: 5, rankAbsolute: 6, domain: 'a.example', url: 'https://a.example/', title: null },
  ],
  aiOverview: {
    asynchronous: true,
    text: '会計ソフトなら◯◯会計が人気です。',
    references: [{ url: 'https://www.maru.example.com/guide', title: null }],
  },
}

function fixedProvider(mode: SerpMode): SerpProvider {
  return {
    mode,
    postTask: async () => ({ taskId: `${mode}-${crypto.randomUUID()}`, costUsd: 0.0012 }),
    fetchTask: async (): Promise<FetchedTask> => ({ status: 'ready', serp: SERP, raw: {} }),
  }
}

/** 検索の結果を 1 日分保存する（ジョブと同じ関数で、指定したモードの結果として） */
async function saveSerp(promptId: string, mode: SerpMode, date: string) {
  await claimSerpTasks(db, date, [{ promptId, mode }])
  const deps = {
    db,
    serp: { providerFor: fixedProvider },
    extractorFor: () => createRuleBasedExtractor(),
  }
  const unlimited = { budgetMs: Number.POSITIVE_INFINITY, promptIds: [promptId] }
  await postSerpTasks(deps, date, unlimited)
  await collectSerpResults(deps, date, unlimited)
}

/** キーワードの質問を持つブランドを登録して 1 回計測し、今日の Google の結果を保存する */
async function setupBrandWithSerp(name: string, mode: SerpMode = 'fake') {
  const client = new TestClient()
  await client.signUp(name)
  const org = await client.createOrganization(`${name} Inc`)
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    domain: 'maru.example.com',
    competitors: [{ name: '競合A', domain: 'a.example' }, { name: '競合B' }],
    prompts: [
      'おすすめの会計ソフトは？',
      { text: '会計ソフト おすすめ', kind: 'keyword' },
      { text: 'クラウド会計 安い', kind: 'keyword' },
    ],
    samplesPerPrompt: 1,
  })
  const brand = json.brand as {
    id: string
    prompts: { id: string; text: string; kind: string }[]
    competitors: { id: string; name: string }[]
  }
  await client.post(`/api/brands/${brand.id}/runs`, {})
  const keyword = brand.prompts.find((p) => p.text === '会計ソフト おすすめ')!
  await saveSerp(keyword.id, mode, todayInTokyo())
  return { client, organizationId: org.json.id as string, brand, keywordId: keyword.id }
}

describe('GET /api/brands/:brandId/serp（Google との比較）', () => {
  it('キーワードの質問ごとに、検索順位・AI による概要・AI の言及率を並べる', async () => {
    const { client, brand, keywordId } = await setupBrandWithSerp('serp-owner')
    const competitorA = brand.competitors.find((c) => c.name === '競合A')!
    const competitorB = brand.competitors.find((c) => c.name === '競合B')!

    const res = await client.get(`/api/brands/${brand.id}/serp`)

    expect(res.status).toBe(200)
    // 質問文の質問は出さない。キーワードの質問だけを登録順に
    expect(res.json.rows.map((r: { text: string }) => r.text)).toEqual([
      '会計ソフト おすすめ',
      'クラウド会計 安い',
    ])
    const [withSerp, withoutSerp] = res.json.rows
    expect(withSerp).toMatchObject({
      promptId: keywordId,
      serp: {
        searchedOn: todayInTokyo(),
        brandRank: 2,
        competitorRanks: { [competitorA.id]: 5, [competitorB.id]: null },
        aiOverviewPresent: true,
        aiOverviewAsynchronous: true,
        brandInAiOverview: true,
        competitorsInAiOverview: [],
      },
    })
    // 1 回の計測で、AI ごとに 1 回答ずつ
    expect(withSerp.ai.openai.n).toBe(1)
    expect(withSerp.ai.gemini.n).toBe(1)
    expect(withoutSerp.serp).toBeNull()
  })

  it('他の組織のブランドは 404', async () => {
    const { brand } = await setupBrandWithSerp('serp-victim')
    const other = new TestClient()
    await other.signUp('serp-other')
    await other.createOrganization('Other Inc')

    const res = await other.get(`/api/brands/${brand.id}/serp`)

    expect(res.status).toBe(404)
    expect(res.json.error.code).toBe('NOT_FOUND')
  })
})

describe('getSerpComparison', () => {
  it('他の組織の ID を渡すと、空になる（テナントの境界）', async () => {
    const { brand } = await setupBrandWithSerp('serp-tenant')
    const other = new TestClient()
    await other.signUp('serp-tenant-other')
    const otherOrg = await other.createOrganization('Tenant Other Inc')

    const result = await getSerpComparison(otherOrg.json.id, brand.id, {
      serpMode: 'fake',
      llmMode: 'fake',
    })

    expect(result.rows).toEqual([])
  })

  it('本物で検索している組織では、フェイクの結果を出さない。本物の結果は出す', async () => {
    const { organizationId, brand, keywordId } = await setupBrandWithSerp('serp-live', 'fake')
    const live = { serpMode: 'live' as const, llmMode: 'fake' as const }

    const before = await getSerpComparison(organizationId, brand.id, live)
    expect(before.rows.find((r) => r.promptId === keywordId)?.serp).toBeNull()

    // 本物で取った結果なら出す
    await db.delete(serpResult).where(eq(serpResult.promptId, keywordId))
    await saveSerp(keywordId, 'live', todayInTokyo())
    const after = await getSerpComparison(organizationId, brand.id, live)
    expect(after.rows.find((r) => r.promptId === keywordId)?.serp?.brandRank).toBe(2)
  })

  it('いちばん新しい日の結果を出し、直近 7 日より前の結果は出さない', async () => {
    const { organizationId, brand, keywordId } = await setupBrandWithSerp('serp-dates')
    const modes = { serpMode: 'fake' as const, llmMode: 'fake' as const }
    const today = todayInTokyo()
    const plus = (days: number) => {
      const d = new Date(`${today}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString().slice(0, 10)
    }
    await saveSerp(keywordId, 'fake', plus(-3))

    const latest = await getSerpComparison(organizationId, brand.id, modes)
    expect(latest.rows.find((r) => r.promptId === keywordId)?.serp?.searchedOn).toBe(today)

    // 10 日後から見ると、どちらも 7 日より前
    const later = await getSerpComparison(organizationId, brand.id, modes, { today: plus(10) })
    expect(later.rows.find((r) => r.promptId === keywordId)?.serp).toBeNull()
  })
})
