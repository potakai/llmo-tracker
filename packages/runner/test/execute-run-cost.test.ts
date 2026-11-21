import { response, run } from '@llmo/db'
import {
  type AnswerProvider,
  createFakeProvider,
  DEMO_MODEL_PREFIX,
  FAKE_MODEL_PREFIX,
  GEMINI_FREE_SEARCHES_PER_MONTH,
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

type PastAnswer = { model?: string; searchCount: number | null; createdAt?: Date }

/** 別の run の Gemini の回答として、検索した回答を入れておく */
async function seedGeminiAnswers(answers: PastAnswer[]) {
  const { brand, prompts } = await seedBrand({ prompts: ['過去の質問'], samplesPerPrompt: 1 })
  const [past] = await db
    .insert(run)
    .values({ brandId: brand.id, trigger: 'manual', status: 'succeeded' })
    .returning()
  await db.insert(response).values(
    answers.map((a, i) => ({
      runId: past!.id,
      promptId: prompts[0]!.id,
      provider: 'gemini' as const,
      model: a.model ?? 'gemini-3.8-flash',
      sampleIndex: i,
      status: 'succeeded' as const,
      answerText: '過去の回答',
      searchCount: a.searchCount,
      createdAt: a.createdAt ?? new Date(),
    })),
  )
}

// アプリ全体の当月の検索の回数を数えるので、テストの順番に意味がある（上から順に流す）。
// 各テストのあとの当月の検索の回数の合計を、コメントに書いておく
describe('Gemini の検索の費用（無料枠）', () => {
  it('回答に検索回数を保存する', async () => {
    const rows = await runWithPricedGemini(1)
    expect(rows.map((r) => r.searchCount)).toEqual([SEARCHES_PER_ANSWER])
    // 当月：2 回
  })

  it('先月の検索は数えず、無料枠に収まるあいだは検索の費用を 0 にする', async () => {
    const now = new Date()
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
    await seedGeminiAnswers([{ searchCount: GEMINI_FREE_SEARCHES_PER_MONTH, createdAt: lastMonth }])

    const rows = await runWithPricedGemini(2)
    expect(rows.map((r) => r.costUsd)).toEqual([0, 0])
    // 当月：6 回
  })

  it('サンプルの AI とデモの回答は数えない', async () => {
    await seedGeminiAnswers([
      { model: `${FAKE_MODEL_PREFIX}gemini`, searchCount: GEMINI_FREE_SEARCHES_PER_MONTH },
      { model: `${DEMO_MODEL_PREFIX}gemini`, searchCount: GEMINI_FREE_SEARCHES_PER_MONTH },
    ])

    const rows = await runWithPricedGemini(1)
    expect(rows.map((r) => r.costUsd)).toEqual([0])
    // 当月：8 回
  })

  it('回答の数ではなく検索の回数で数え、残りの無料枠を超えた分だけ課金する', async () => {
    // 料金表にない本物のモデルも数える。search_count が null の古い回答は 1 回として数える
    const used = 8 + 1
    await seedGeminiAnswers([
      { model: 'gemini-3.6-flash', searchCount: GEMINI_FREE_SEARCHES_PER_MONTH - used - 1 },
      { searchCount: null },
    ])

    // 残り 1 回で 2 回検索するので、1 回分
    const rows = await runWithPricedGemini(1)
    expect(rows[0]?.costUsd).toBeCloseTo(0.014, 6)
    // 当月：5,001 回
  })

  it('無料枠を使い切ったあとの回答には、検索の回数分の費用がかかる', async () => {
    const rows = await runWithPricedGemini(1)
    expect(rows[0]?.costUsd).toBeCloseTo(GEMINI_SEARCH_COST, 6)
  })
})
