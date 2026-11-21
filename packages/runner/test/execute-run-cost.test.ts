import { response, run } from '@llmo/db'
import {
  type AnswerProvider,
  createFakeProvider,
  GEMINI_FREE_SEARCH_REQUESTS_PER_MONTH,
} from '@llmo/llm'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createManualRun, executeRun } from '../src'
import { countingProviders, db, extractor, seedBrand } from './fixtures'

const SEARCHES_PER_ANSWER = 2
const GEMINI_SEARCH_COST = SEARCHES_PER_ANSWER * 0.014

/**
 * 料金表にあるモデル名を名乗るスタブ（本物の API は叩かない）。トークンは 0 にして、検索の費用だけを見る
 */
function pricedGemini(): AnswerProvider {
  const fake = createFakeProvider('gemini')
  return {
    id: 'gemini',
    model: 'gemini-3.8-flash',
    async ask(input) {
      const result = await fake.ask(input)
      return {
        ...result,
        model: 'gemini-3.8-flash',
        inputTokens: 0,
        outputTokens: 0,
        searchCount: SEARCHES_PER_ANSWER,
      }
    },
  }
}

async function runWithPricedGemini(samplesPerPrompt: number) {
  const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt })
  const created = await createManualRun(db, brand.id)
  const { providers } = countingProviders({ gemini: pricedGemini() })
  await executeRun({ db, providers, extractor, concurrency: 1 }, created.id)
  return db
    .select()
    .from(response)
    .where(and(eq(response.runId, created.id), eq(response.provider, 'gemini')))
}

/** 当月の Gemini の検索のリクエストを、別の run の回答として n 件入れておく */
async function seedGeminiSearchRequests(n: number, createdAt: Date, model = 'gemini-3.8-flash') {
  const { brand, prompts } = await seedBrand({ prompts: ['過去の質問'], samplesPerPrompt: 1 })
  const [past] = await db
    .insert(run)
    .values({ brandId: brand.id, trigger: 'manual', status: 'succeeded' })
    .returning()
  await db.insert(response).values(
    Array.from({ length: n }, (_, i) => ({
      runId: past!.id,
      promptId: prompts[0]!.id,
      provider: 'gemini' as const,
      model,
      sampleIndex: i,
      status: 'succeeded' as const,
      answerText: '過去の回答',
      searchCount: 1,
      createdAt,
    })),
  )
}

// アプリ全体の当月の回数を数えるので、テストの順番に意味がある（上から順に流す）
describe('Gemini の検索の費用（無料枠）', () => {
  it('回答に検索回数を保存する', async () => {
    const rows = await runWithPricedGemini(1)
    expect(rows.map((r) => r.searchCount)).toEqual([SEARCHES_PER_ANSWER])
  })

  it('当月の検索のリクエストが無料枠に収まっているあいだは、検索の費用を 0 にする', async () => {
    // 先月の分は数えない
    const now = new Date()
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
    await seedGeminiSearchRequests(GEMINI_FREE_SEARCH_REQUESTS_PER_MONTH, lastMonth)

    const rows = await runWithPricedGemini(2)
    expect(rows.map((r) => r.costUsd)).toEqual([0, 0])
  })

  it('無料枠を使い切ったあとの回答には、検索の費用がかかる（日付付きのモデル名の回答も数える）', async () => {
    await seedGeminiSearchRequests(
      GEMINI_FREE_SEARCH_REQUESTS_PER_MONTH,
      new Date(),
      'gemini-3.8-flash-2026-11-01',
    )

    const rows = await runWithPricedGemini(1)
    expect(rows[0]?.costUsd).toBeCloseTo(GEMINI_SEARCH_COST, 6)
  })
})
