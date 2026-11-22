import { brand as brandTable, organization, prompt, run } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  createDailyRuns,
  createManualRun,
  executeRun,
  executeRunSlice,
  isDemoMetadata,
  tokyoDate,
} from '../src'
import { startRun } from '../src/execute-run'
import { countingProviders, db, extractor, seedBrand } from './fixtures'

// テストどうしで日付がぶつからないように、テストごとに別の日を使う
let day = 0
const nextDate = () => `2030-01-${String(++day).padStart(2, '0')}`

const createdBrandIds = async (date: string) =>
  (await createDailyRuns(db, date)).created.map((c) => c.brandId)

describe('createDailyRuns', () => {
  it('有効な質問があるブランドに、その日の run を 1 つ作る。2 回呼んでも増えない', async () => {
    const { brand } = await seedBrand()
    const date = nextDate()

    expect(await createdBrandIds(date)).toContain(brand.id)
    expect(await createdBrandIds(date)).not.toContain(brand.id)

    const runs = await db.select().from(run).where(eq(run.brandId, brand.id))
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ trigger: 'scheduled', scheduledFor: date, status: 'queued' })
  })

  it('質問がすべてアーカイブされたブランドは対象外', async () => {
    const { brand } = await seedBrand()
    await db.update(prompt).set({ archivedAt: new Date() }).where(eq(prompt.brandId, brand.id))

    expect(await createdBrandIds(nextDate())).not.toContain(brand.id)
  })

  it('自動計測をオフにしたブランドは対象外。オンに戻すとまた作る', async () => {
    const { brand } = await seedBrand()
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))

    const date = nextDate()
    const result = await createDailyRuns(db, date)
    expect(result.created.map((c) => c.brandId)).not.toContain(brand.id)
    expect(await db.select().from(run).where(eq(run.brandId, brand.id))).toHaveLength(0)

    await db.update(brandTable).set({ scheduleEnabled: true }).where(eq(brandTable.id, brand.id))
    expect(await createdBrandIds(date)).toContain(brand.id)
  })

  it('自動計測をオフにしても、手動の計測はできる', async () => {
    const { brand } = await seedBrand()
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))

    const manual = await createManualRun(db, brand.id)
    expect(manual).toMatchObject({ brandId: brand.id, trigger: 'manual', status: 'queued' })
  })

  it('デモ組織のブランドは対象外（計測すると費用がかかる）', async () => {
    const { brand } = await seedBrand()
    await db
      .update(organization)
      .set({ metadata: JSON.stringify({ demo: true }) })
      .where(eq(organization.id, brand.organizationId))

    expect(await createdBrandIds(nextDate())).not.toContain(brand.id)
  })

  it('手動の実行が動いているブランドは、その日は作らない（同時に動く run は 1 つまで）', async () => {
    const { brand } = await seedBrand()
    await createManualRun(db, brand.id)

    const result = await createDailyRuns(db, nextDate())
    expect(result.created.map((c) => c.brandId)).not.toContain(brand.id)
    expect(result.skipped).toBeGreaterThan(0)
  })
})

describe('isDemoMetadata', () => {
  it('{"demo":true} のときだけ true。壊れた JSON でも落ちない', () => {
    expect(isDemoMetadata(JSON.stringify({ demo: true }))).toBe(true)
    expect(isDemoMetadata(JSON.stringify({ demo: 'true' }))).toBe(false)
    expect(isDemoMetadata(null)).toBe(false)
    expect(isDemoMetadata('{壊れた')).toBe(false)
  })
})

describe('tokyoDate', () => {
  it('日本時間の日付を返す（UTC では前日の 21:00 = 日本時間の翌日 6:00）', () => {
    expect(tokyoDate(new Date('2026-11-04T21:00:00Z'))).toBe('2026-11-05')
    expect(tokyoDate(new Date('2026-11-04T14:59:59Z'))).toBe('2026-11-04')
  })
})

describe('createDailyRuns の toDispatch', () => {
  it('前回ジョブに渡せなかった queued の run も、もう一度渡す対象に入る', async () => {
    const { brand } = await seedBrand()
    const date = nextDate()
    const first = await createDailyRuns(db, date)
    const runId = first.created.find((c) => c.brandId === brand.id)?.runId
    expect(first.toDispatch).toContain(runId)

    // 2 回目は作らないが、まだ queued なので渡す対象には残る
    const second = await createDailyRuns(db, date)
    expect(second.created.map((c) => c.brandId)).not.toContain(brand.id)
    expect(second.toDispatch).toContain(runId)

    // 動き出したら対象から外れる
    await db.update(run).set({ status: 'running' }).where(eq(run.id, runId!))
    expect((await createDailyRuns(db, date)).toDispatch).not.toContain(runId)
  })
})

describe('自動計測をオフにしたあとの、朝のジョブの再試行', () => {
  /** その日の自動 run を作り、ジョブに渡す前に落ちた（queued のまま）状態にしてから、自動計測をオフにする */
  async function queuedScheduledRunThenTurnedOff() {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const date = nextDate()
    const first = await createDailyRuns(db, date)
    const runId = first.created.find((c) => c.brandId === brand.id)!.runId
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))
    return { brand, date, runId }
  }

  it('queued の自動 run は配信せず、取り消し（理由：自動計測がオフ）にして終わらせる', async () => {
    const { date, runId } = await queuedScheduledRunThenTurnedOff()

    const retry = await createDailyRuns(db, date)
    expect(retry.toDispatch).not.toContain(runId)
    expect(retry.cancelled).toContain(runId)

    const [row] = await db.select().from(run).where(eq(run.id, runId))
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'schedule_disabled' })
    expect(row?.finishedAt).not.toBeNull()
  })

  it('取り消したあとは、手動の計測がブロックされない', async () => {
    const { brand, date } = await queuedScheduledRunThenTurnedOff()
    await createDailyRuns(db, date)

    const manual = await createManualRun(db, brand.id)
    expect(manual).toMatchObject({ trigger: 'manual', status: 'queued' })
  })

  it('取り消した run がジョブに届いても、AI には聞かず、取り消しのまま', async () => {
    const { date, runId } = await queuedScheduledRunThenTurnedOff()
    await createDailyRuns(db, date)

    const counting = countingProviders()
    const summary = await executeRun({ db, providers: counting.providers, extractor }, runId)
    expect(counting.calls).toEqual({ openai: 0, gemini: 0 })
    expect(summary.status).toBe('cancelled')
    const [row] = await db.select({ status: run.status }).from(run).where(eq(run.id, runId))
    expect(row?.status).toBe('cancelled')
  })

  it('オンのブランドの queued の run と、動き出した run は取り消さない', async () => {
    const on = await seedBrand({ samplesPerPrompt: 1 })
    const off = await seedBrand({ samplesPerPrompt: 1 })
    const date = nextDate()
    const first = await createDailyRuns(db, date)
    const onRunId = first.created.find((c) => c.brandId === on.brand.id)!.runId
    const offRunId = first.created.find((c) => c.brandId === off.brand.id)!.runId
    await db.update(run).set({ status: 'running' }).where(eq(run.id, offRunId))
    await db
      .update(brandTable)
      .set({ scheduleEnabled: false })
      .where(eq(brandTable.id, off.brand.id))

    const retry = await createDailyRuns(db, date)
    expect(retry.toDispatch).toContain(onRunId)
    expect(retry.cancelled).not.toContain(onRunId)
    expect(retry.cancelled).not.toContain(offRunId)
    const [offRow] = await db.select({ status: run.status }).from(run).where(eq(run.id, offRunId))
    expect(offRow?.status).toBe('running')
  })
})

describe('自動計測をオフにしたあと、朝のジョブの配信ステップだけが再試行された', () => {
  /**
   * Inngest は成功したステップ（create-daily-runs）の結果を覚えていて、再試行では作り直さない。
   * なので、オフにする前に作った toDispatch がそのまま配信される。それを executeRun が受け取る
   */
  async function dispatchedAfterTurnedOff() {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const memoized = await createDailyRuns(db, nextDate())
    const runId = memoized.toDispatch.find(
      (id) => memoized.created.find((c) => c.runId === id)?.brandId === brand.id,
    )!
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))
    return { brand, runId }
  }

  it('自動 run は AI に聞かず、取り消し（理由：自動計測がオフ）になる', async () => {
    const { runId } = await dispatchedAfterTurnedOff()

    const counting = countingProviders()
    const summary = await executeRun({ db, providers: counting.providers, extractor }, runId)

    expect(counting.calls).toEqual({ openai: 0, gemini: 0 })
    expect(summary.status).toBe('cancelled')
    const [row] = await db.select().from(run).where(eq(run.id, runId))
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'schedule_disabled' })
    expect(row?.startedAt).toBeNull()
    expect(row?.finishedAt).not.toBeNull()
  })

  it('取り消したあとは、手動の計測ができる', async () => {
    const { brand, runId } = await dispatchedAfterTurnedOff()
    await executeRun({ db, providers: countingProviders().providers, extractor }, runId)

    expect(await createManualRun(db, brand.id)).toMatchObject({ status: 'queued' })
  })

  it('手動の run は、オフでも実行する', async () => {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))
    const manual = await createManualRun(db, brand.id)

    const counting = countingProviders()
    const summary = await executeRun({ db, providers: counting.providers, extractor }, manual.id)
    expect(summary.status).toBe('succeeded')
    expect(counting.calls.openai + counting.calls.gemini).toBeGreaterThan(0)
  })

  it('動き出した自動 run は、途中でオフにしても最後まで実行する（区切って続きから再開する場合）', async () => {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const memoized = await createDailyRuns(db, nextDate())
    const runId = memoized.created.find((c) => c.brandId === brand.id)!.runId
    const deps = { db, providers: countingProviders().providers, extractor }
    // 最初の回は予算 0 で、running にしたところで区切る
    expect(await executeRunSlice(deps, runId, { budgetMs: 0 })).toEqual({ done: false })
    await db.update(brandTable).set({ scheduleEnabled: false }).where(eq(brandTable.id, brand.id))

    const summary = await executeRun(deps, runId)
    expect(summary.status).toBe('succeeded')
  })
})

describe('run の開始（startRun）：確認と開始を 1 つの UPDATE で行う', () => {
  async function queuedRun(trigger: 'scheduled' | 'manual', scheduleEnabled: boolean) {
    const { brand } = await seedBrand({ samplesPerPrompt: 1 })
    const created =
      trigger === 'manual'
        ? await createManualRun(db, brand.id)
        : (await createDailyRuns(db, nextDate())).created.find((c) => c.brandId === brand.id)!
    const runId = 'runId' in created ? created.runId : created.id
    await db.update(brandTable).set({ scheduleEnabled }).where(eq(brandTable.id, brand.id))
    return runId
  }

  const statusOf = async (runId: string) =>
    (await db.select({ status: run.status }).from(run).where(eq(run.id, runId)))[0]?.status

  it('自動計測がオフのブランドの queued の自動 run は、開始しない（queued のまま）', async () => {
    const runId = await queuedRun('scheduled', false)
    expect(await startRun(db, runId)).toBe(false)
    expect(await statusOf(runId)).toBe('queued')
  })

  it('オンなら自動 run を開始する。手動 run はオフでも開始する', async () => {
    const scheduled = await queuedRun('scheduled', true)
    expect(await startRun(db, scheduled)).toBe(true)
    expect(await statusOf(scheduled)).toBe('running')

    const manual = await queuedRun('manual', false)
    expect(await startRun(db, manual)).toBe(true)
    expect(await statusOf(manual)).toBe('running')
  })

  it('動き出した自動 run は、オフにしても続きを開始できる。終わった run は開始しない', async () => {
    const runId = await queuedRun('scheduled', true)
    await startRun(db, runId)
    const [row] = await db.select({ brandId: run.brandId }).from(run).where(eq(run.id, runId))
    await db
      .update(brandTable)
      .set({ scheduleEnabled: false })
      .where(eq(brandTable.id, row!.brandId))
    expect(await startRun(db, runId)).toBe(true)

    await db.update(run).set({ status: 'succeeded' }).where(eq(run.id, runId))
    expect(await startRun(db, runId)).toBe(false)
    expect(await statusOf(runId)).toBe('succeeded')
  })
})
