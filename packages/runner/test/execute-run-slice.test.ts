import { analysis, response, run } from '@llmo/db'
import { createFakeProvider, type Extractor } from '@llmo/llm'
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createManualRun, executeRun, executeRunSlice } from '../src'
import { countingProviders, db, extractor, seedBrand } from './fixtures'

/** 1 回の slice を何度も呼ぶときの上限（無限ループでテストが止まらないように） */
const MAX_SLICES = 50
const SLOW_MS = 30
/** 遅い処理が 2 つくらい終わったところで区切られる予算 */
const SMALL_BUDGET_MS = 50

/** 抽出に時間がかかる抽出器 */
function slowExtractor(delayMs: number): Extractor {
  return {
    extract: async (input) => {
      await new Promise((r) => setTimeout(r, delayMs))
      return extractor.extract(input)
    },
  }
}

async function responsesOf(runId: string) {
  return db.select().from(response).where(eq(response.runId, runId))
}

async function analysesOf(runId: string) {
  const ids = (await responsesOf(runId)).map((r) => r.id)
  if (ids.length === 0) return []
  return db.select().from(analysis).where(inArray(analysis.responseId, ids))
}

describe('executeRunSlice', () => {
  it('予算が小さいと 1 回では終わらず done: false を返し、何回か呼ぶと done: true になる。回答は二重に保存されない', async () => {
    // Arrange：1 質問 × 2 AI × 3 回 = 6 件。1 件ずつ、30ms かかる
    const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt: 3 })
    const created = await createManualRun(db, brand.id)
    const { providers, calls } = countingProviders({
      openai: createFakeProvider('openai', { delayMs: SLOW_MS }),
      gemini: createFakeProvider('gemini', { delayMs: SLOW_MS }),
    })
    const deps = { db, providers, extractor, concurrency: 1 }

    // Act
    const first = await executeRunSlice(deps, created.id, { budgetMs: SMALL_BUDGET_MS })
    const afterFirst = await responsesOf(created.id)
    let slices = 1
    let result = first
    while (!result.done && slices < MAX_SLICES) {
      result = await executeRunSlice(deps, created.id, { budgetMs: SMALL_BUDGET_MS })
      slices += 1
      // 途中の回でも、同じ回答が二重に保存されていない
      const rows = await responsesOf(created.id)
      const keys = rows.map((r) => `${r.promptId}:${r.provider}:${r.sampleIndex}`)
      expect(new Set(keys).size).toBe(rows.length)
    }

    // Assert
    expect(first).toEqual({ done: false })
    expect(afterFirst.length).toBeGreaterThan(0)
    expect(afterFirst.length).toBeLessThan(6)
    expect(slices).toBeGreaterThan(1)
    expect(result).toMatchObject({
      done: true,
      summary: { status: 'succeeded', total: 6, succeeded: 6 },
    })
    // 成功済みを聞き直していない
    expect(calls.openai + calls.gemini).toBe(6)
    const [finished] = await db.select().from(run).where(eq(run.id, created.id))
    expect(finished?.status).toBe('succeeded')
  })

  it('抽出の途中で区切られても、最後まで呼べば全回答に analysis が付く', async () => {
    // Arrange：回答は速く、抽出が遅い
    const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt: 3 })
    const created = await createManualRun(db, brand.id)
    const deps = {
      db,
      providers: countingProviders().providers,
      extractor: slowExtractor(SLOW_MS),
      concurrency: 1,
    }

    // Act
    const partialCounts: number[] = []
    let result = await executeRunSlice(deps, created.id, { budgetMs: SMALL_BUDGET_MS })
    let slices = 1
    while (!result.done && slices < MAX_SLICES) {
      partialCounts.push((await analysesOf(created.id)).length)
      // 抽出が終わるまで、run は終わらない
      const [current] = await db.select().from(run).where(eq(run.id, created.id))
      expect(current?.status).toBe('running')
      result = await executeRunSlice(deps, created.id, { budgetMs: SMALL_BUDGET_MS })
      slices += 1
    }

    // Assert：抽出が一部だけ済んだ状態で区切られた回がある
    expect(partialCounts.some((n) => n > 0 && n < 6)).toBe(true)
    expect(result).toMatchObject({ done: true, summary: { status: 'succeeded', total: 6 } })
    const analyses = await analysesOf(created.id)
    expect(analyses).toHaveLength(6)
  })

  it('終わった run に呼んでも、AI に聞かず何も変わらない', async () => {
    // Arrange
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const created = await createManualRun(db, brand.id)
    await executeRun({ db, providers: countingProviders().providers, extractor }, created.id)
    const [runBefore] = await db.select().from(run).where(eq(run.id, created.id))
    const responsesBefore = await responsesOf(created.id)
    const analysesBefore = await analysesOf(created.id)

    // Act
    const again = countingProviders()
    const result = await executeRunSlice(
      { db, providers: again.providers, extractor },
      created.id,
      { budgetMs: SMALL_BUDGET_MS },
    )

    // Assert
    expect(result).toMatchObject({ done: true, summary: { status: 'succeeded', total: 4 } })
    expect(again.calls).toEqual({ openai: 0, gemini: 0 })
    const [runAfter] = await db.select().from(run).where(eq(run.id, created.id))
    expect(runAfter).toEqual(runBefore)
    expect(await responsesOf(created.id)).toEqual(responsesBefore)
    expect(await analysesOf(created.id)).toEqual(analysesBefore)
  })

  it('失敗し続ける AI があっても、失敗した回答は聞き直さずに終わる（partial）', async () => {
    // Arrange：gemini は毎回失敗する
    const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt: 3 })
    const created = await createManualRun(db, brand.id)
    const { providers, calls } = countingProviders({
      openai: createFakeProvider('openai', { delayMs: SLOW_MS }),
      gemini: createFakeProvider('gemini', { delayMs: SLOW_MS, failWhen: () => true }),
    })
    const deps = { db, providers, extractor, concurrency: 1 }

    // Act
    let result = await executeRunSlice(deps, created.id, { budgetMs: SMALL_BUDGET_MS })
    let slices = 1
    while (!result.done && slices < MAX_SLICES) {
      result = await executeRunSlice(deps, created.id, { budgetMs: SMALL_BUDGET_MS })
      slices += 1
    }

    // Assert
    expect(result).toMatchObject({
      done: true,
      summary: { status: 'partial', total: 6, succeeded: 3, failed: 3 },
    })
    expect(calls).toEqual({ openai: 3, gemini: 3 })
  })

  it('retryFailedBefore より前に失敗した回答だけを聞き直す', async () => {
    // Arrange：1 回目は gemini が全部失敗して終わる
    const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt: 2 })
    const created = await createManualRun(db, brand.id)
    const first = countingProviders({
      gemini: createFakeProvider('gemini', { failWhen: () => true }),
    })
    await executeRunSlice({ db, providers: first.providers, extractor }, created.id, {
      budgetMs: Number.POSITIVE_INFINITY,
    })
    await db.update(run).set({ status: 'running' }).where(eq(run.id, created.id))

    // Act：失敗のあとの時刻を渡す
    const second = countingProviders()
    const result = await executeRunSlice(
      { db, providers: second.providers, extractor },
      created.id,
      {
        budgetMs: Number.POSITIVE_INFINITY,
        retryFailedBefore: new Date(Date.now() + 60_000),
      },
    )

    // Assert
    expect(second.calls).toEqual({ openai: 0, gemini: 2 })
    expect(result).toMatchObject({ done: true, summary: { status: 'succeeded', succeeded: 4 } })
  })
})
