import { citation, response, run } from '@llmo/db'
import { createFakeProvider } from '@llmo/llm'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createManualRun, createScheduledRun, executeRun, RunAlreadyActiveError } from '../src'
import { countingProviders, db, extractor, seedBrand } from './fixtures'

describe('executeRun', () => {
  it('質問 × AI × サンプル数 の分だけ聞いて、回答と引用元を保存する', async () => {
    const { brand } = await seedBrand({ prompts: ['質問1', '質問2'], samplesPerPrompt: 3 })
    const created = await createManualRun(db, brand.id)
    const { providers, calls } = countingProviders()

    const summary = await executeRun({ db, providers, extractor }, created.id)

    // 2 質問 × 2 AI × 3 回 = 12
    expect(summary).toMatchObject({ status: 'succeeded', total: 12, succeeded: 12, failed: 0 })
    expect(calls).toEqual({ openai: 6, gemini: 6 })

    const [saved] = await db.select().from(run).where(eq(run.id, created.id))
    expect(saved?.status).toBe('succeeded')
    expect(saved?.startedAt).not.toBeNull()
    expect(saved?.finishedAt).not.toBeNull()

    const rows = await db.select().from(response).where(eq(response.runId, created.id))
    expect(rows.every((r) => r.answerText && r.model.startsWith('fake-'))).toBe(true)
    // フェイクのモデルは料金表にないので費用は不明（null）
    expect(rows.every((r) => r.costUsd === null)).toBe(true)

    const cites = await db.select().from(citation).where(eq(citation.responseId, rows[0]!.id))
    expect(cites.length).toBeGreaterThan(0)
  })

  it('一部が失敗したら partial になり、失敗の理由が残る', async () => {
    const { brand } = await seedBrand({ prompts: ['質問1', '壊れる質問'], samplesPerPrompt: 2 })
    const created = await createManualRun(db, brand.id)
    const { providers } = countingProviders({
      gemini: createFakeProvider('gemini', { failWhen: (i) => i.prompt === '壊れる質問' }),
    })

    const summary = await executeRun({ db, providers, extractor }, created.id)

    expect(summary).toMatchObject({ status: 'partial', total: 8, succeeded: 6, failed: 2 })
    const failed = await db.select().from(response).where(eq(response.status, 'failed'))
    expect(failed.some((r) => r.error?.includes('意図的な失敗'))).toBe(true)
  })

  it('途中で落ちた run は、残りの分だけ聞いて再開する', async () => {
    const { brand } = await seedBrand({ prompts: ['質問1'], samplesPerPrompt: 5 })
    const created = await createManualRun(db, brand.id)

    // 1 回目：gemini が全部失敗した状態で止まった、という想定を作る
    const first = countingProviders({
      gemini: createFakeProvider('gemini', { failWhen: () => true }),
    })
    await executeRun({ db, providers: first.providers, extractor }, created.id)
    await db.update(run).set({ status: 'running' }).where(eq(run.id, created.id))

    // 2 回目：成功済みの openai は聞かず、失敗していた gemini だけ聞き直す
    const second = countingProviders()
    const summary = await executeRun({ db, providers: second.providers, extractor }, created.id)

    expect(second.calls).toEqual({ openai: 0, gemini: 5 })
    expect(summary).toMatchObject({ status: 'succeeded', total: 10, succeeded: 10 })
  })

  it('終わっている run をもう一度渡しても、AI には聞かない', async () => {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const created = await createManualRun(db, brand.id)
    await executeRun({ db, providers: countingProviders().providers, extractor }, created.id)

    const again = countingProviders()
    const summary = await executeRun({ db, providers: again.providers, extractor }, created.id)
    expect(again.calls).toEqual({ openai: 0, gemini: 0 })
    expect(summary.status).toBe('succeeded')
  })
})

describe('run の作成', () => {
  it('実行中の run があるあいだは、手動実行を新しく作れない', async () => {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const first = await createManualRun(db, brand.id)
    await expect(createManualRun(db, brand.id)).rejects.toBeInstanceOf(RunAlreadyActiveError)

    // 終わったらまた作れる
    await executeRun({ db, providers: countingProviders().providers, extractor }, first.id)
    await expect(createManualRun(db, brand.id)).resolves.toBeTruthy()
  })

  it('自動実行は 1 ブランド 1 日 1 回', async () => {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const first = await createScheduledRun(db, brand.id, '2026-10-29')
    expect(first).not.toBeNull()
    await executeRun({ db, providers: countingProviders().providers, extractor }, first!.id)

    expect(await createScheduledRun(db, brand.id, '2026-10-29')).toBeNull()
    expect(await createScheduledRun(db, brand.id, '2026-10-30')).not.toBeNull()
  })
})

describe('組織ごとに AI を選ぶ（llmFor）', () => {
  it('run のブランドの組織に合った AI だけを使う', async () => {
    const live = await seedBrand({ samplesPerPrompt: 1 })
    const other = await seedBrand({ samplesPerPrompt: 1 })
    const liveLlm = countingProviders()
    const fakeLlm = countingProviders()
    const asked: string[] = []
    const deps = {
      db,
      llmFor: (organizationId: string) => {
        asked.push(organizationId)
        return {
          providers:
            organizationId === live.brand.organizationId ? liveLlm.providers : fakeLlm.providers,
          extractor,
        }
      },
    }

    await executeRun(deps, (await createManualRun(db, live.brand.id)).id)
    expect(liveLlm.calls.openai).toBeGreaterThan(0)
    expect(fakeLlm.calls.openai).toBe(0)

    await executeRun(deps, (await createManualRun(db, other.brand.id)).id)
    expect(fakeLlm.calls.openai).toBeGreaterThan(0)
    expect(asked).toEqual([live.brand.organizationId, other.brand.organizationId])
  })
})
