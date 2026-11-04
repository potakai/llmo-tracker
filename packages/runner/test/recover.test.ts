import { response, run } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { abandonRun, createManualRun, executeRun, recoverStaleRuns } from '../src'
import { countingProviders, db, extractor, seedBrand } from './fixtures'

const minutesLater = (minutes: number, from = new Date()) =>
  new Date(from.getTime() + minutes * 60_000)

async function statusOf(runId: string) {
  const [row] = await db.select().from(run).where(eq(run.id, runId))
  return row!
}

/** 回答を 1 件だけ保存した「途中で止まった run」を作る */
async function seedStuckRun(options: { answeredMinutesAgo: number }) {
  const { brand, prompts } = await seedBrand()
  const created = await createManualRun(db, brand.id)
  await db
    .update(run)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(run.id, created.id))
  await db.insert(response).values({
    runId: created.id,
    promptId: prompts[0]!.id,
    provider: 'openai',
    sampleIndex: 0,
    model: 'fake-openai',
    status: 'succeeded',
    answerText: '回答',
    costUsd: 0.0123,
    createdAt: minutesLater(-options.answeredMinutesAgo),
  })
  return { brand, runId: created.id }
}

describe('recoverStaleRuns', () => {
  it('30 分なにも進んでいない queued の run は failed にする。29 分ならそのまま', async () => {
    const { brand } = await seedBrand()
    const created = await createManualRun(db, brand.id)

    const early = await recoverStaleRuns(db, { now: minutesLater(29) })
    expect(early.map((r) => r.runId)).not.toContain(created.id)
    expect((await statusOf(created.id)).status).toBe('queued')

    const late = await recoverStaleRuns(db, { now: minutesLater(31) })
    expect(late).toContainEqual({ runId: created.id, status: 'failed' })
    const closed = await statusOf(created.id)
    expect(closed.status).toBe('failed')
    expect(closed.finishedAt).not.toBeNull()
  })

  it('回答が保存され続けている run は、開始から時間がたっていても回収しない', async () => {
    const { runId } = await seedStuckRun({ answeredMinutesAgo: 0 })
    // 開始は 1 時間前でも、最後の回答が 29 分前なら動いているとみなす
    await db
      .update(run)
      .set({ startedAt: minutesLater(-60), createdAt: minutesLater(-60) })
      .where(eq(run.id, runId))

    const recovered = await recoverStaleRuns(db, { now: minutesLater(29) })
    expect(recovered.map((r) => r.runId)).not.toContain(runId)
    expect((await statusOf(runId)).status).toBe('running')
  })

  it('成功した回答がある run は partial にして、そこまでの費用を残す', async () => {
    const { runId } = await seedStuckRun({ answeredMinutesAgo: 45 })
    await db
      .update(run)
      .set({ startedAt: minutesLater(-50), createdAt: minutesLater(-50) })
      .where(eq(run.id, runId))

    const recovered = await recoverStaleRuns(db)
    expect(recovered).toContainEqual({ runId, status: 'partial' })
    expect((await statusOf(runId)).totalCostUsd).toBeCloseTo(0.0123)
  })

  it('回収すると、そのブランドで次の実行ができるようになる', async () => {
    const { brand, runId } = await seedStuckRun({ answeredMinutesAgo: 45 })
    await db
      .update(run)
      .set({ startedAt: minutesLater(-50), createdAt: minutesLater(-50) })
      .where(eq(run.id, runId))
    await expect(createManualRun(db, brand.id)).rejects.toThrow()

    await recoverStaleRuns(db)
    const next = await createManualRun(db, brand.id)
    expect(next.status).toBe('queued')
  })

  it('終わっている run には触らない', async () => {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const created = await createManualRun(db, brand.id)
    await executeRun({ db, providers: countingProviders().providers, extractor }, created.id)
    const before = await statusOf(created.id)

    const recovered = await recoverStaleRuns(db, { now: minutesLater(60 * 24) })
    expect(recovered.map((r) => r.runId)).not.toContain(created.id)
    expect(await statusOf(created.id)).toEqual(before)
  })
})

describe('abandonRun', () => {
  it('実行中の run をその場で終わらせる。終わっている run なら null', async () => {
    const { runId } = await seedStuckRun({ answeredMinutesAgo: 0 })

    expect(await abandonRun(db, runId)).toEqual({ runId, status: 'partial' })
    expect(await abandonRun(db, runId)).toBeNull()
  })
})
