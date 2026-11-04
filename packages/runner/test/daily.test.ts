import { organization, prompt, run } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDailyRuns, createManualRun, isDemoMetadata, tokyoDate } from '../src'
import { db, seedBrand } from './fixtures'

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
