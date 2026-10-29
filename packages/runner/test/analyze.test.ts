import { analysis, mention, response } from '@llmo/db'
import { EXTRACTION_SCHEMA_VERSION, type Extractor } from '@llmo/llm'
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { analyzeRun, createManualRun, executeRun } from '../src'
import { countingProviders, db, extractor, seedBrand } from './fixtures'

async function executedRun() {
  const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt: 2 })
  const created = await createManualRun(db, brand.id)
  await executeRun({ db, providers: countingProviders().providers, extractor }, created.id)
  const responses = await db.select().from(response).where(eq(response.runId, created.id))
  return { runId: created.id, responseIds: responses.map((r) => r.id) }
}

describe('analyzeRun', () => {
  it('実行が終わると、成功した回答すべてに分析結果と言及が保存されている', async () => {
    const { responseIds } = await executedRun()
    const rows = await db.select().from(analysis).where(inArray(analysis.responseId, responseIds))
    expect(rows).toHaveLength(4) // 1 質問 × 2 AI × 2 回
    expect(rows.every((r) => r.extractorModel === 'rule-based')).toBe(true)

    // フェイクの回答には自社名が入るので、言及が拾えている
    const mentions = await db.select().from(mention).where(inArray(mention.responseId, responseIds))
    expect(mentions.some((m) => m.entityType === 'brand')).toBe(true)
    expect(mentions.some((m) => m.entityType === 'competitor' && m.competitorId)).toBe(true)
  })

  it('分析済みの回答は、もう一度呼んでも分析しない', async () => {
    const { runId } = await executedRun()
    const again = await analyzeRun({ db, extractor }, runId)
    expect(again.analyzed).toBe(0)
  })

  it('古い版で分析した回答と、force 指定のときは分析し直す', async () => {
    const { runId, responseIds } = await executedRun()
    await db
      .update(analysis)
      .set({ schemaVersion: EXTRACTION_SCHEMA_VERSION - 1 })
      .where(eq(analysis.responseId, responseIds[0]!))
    expect((await analyzeRun({ db, extractor }, runId)).analyzed).toBe(1)

    // 「何も見つからない」抽出器で force すると、言及が作り直されて 0 件になる
    const empty: Extractor = {
      extract: async () => ({
        brandMentioned: false,
        brandRank: null,
        sentiment: null,
        mentions: [],
        extractorModel: 'empty',
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        raw: null,
      }),
    }
    expect((await analyzeRun({ db, extractor: empty }, runId, { force: true })).analyzed).toBe(4)
    const mentions = await db.select().from(mention).where(inArray(mention.responseId, responseIds))
    expect(mentions).toHaveLength(0)
  })
})
