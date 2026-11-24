import { brand as brandTable, type Db, organization, siteAudit } from '@llmo/db'
import type { SiteMode } from '@llmo/site'
import { and, eq, isNotNull } from 'drizzle-orm'
import { isDemoMetadata } from '../scheduled-brands'

export class SiteAuditAlreadyActiveError extends Error {
  constructor() {
    super('このブランドのサイト診断はすでに動いています')
  }
}

export class SiteAuditDailyLimitError extends Error {
  constructor() {
    super('今すぐ診断は 1 日 1 回までです')
  }
}

type NewAudit = { brandId: string; domain: string; mode: SiteMode; date: string }

/**
 * 「今すぐ診断」の診断を作る。1 ブランド 1 日 1 回まで、同時に動くのは 1 つまで（どちらも DB の一意制約で守る）。
 * 同時に押されても 1 つしか作られない
 */
export async function createManualSiteAudit(db: Db, input: NewAudit) {
  const [created] = await db
    .insert(siteAudit)
    .values({
      brandId: input.brandId,
      trigger: 'manual',
      mode: input.mode,
      requestedOn: input.date,
      domain: input.domain,
    })
    .onConflictDoNothing()
    .returning()
  if (created) return created

  const [today] = await db
    .select({ id: siteAudit.id })
    .from(siteAudit)
    .where(
      and(
        eq(siteAudit.brandId, input.brandId),
        eq(siteAudit.trigger, 'manual'),
        eq(siteAudit.requestedOn, input.date),
      ),
    )
    .limit(1)
  if (today) throw new SiteAuditDailyLimitError()
  throw new SiteAuditAlreadyActiveError()
}

/**
 * ジョブに渡せなかった手動の診断を消す（まだ何も読んでいないので、残すと今日もう押せなくなるだけ）。
 * 動き始めたもの（queued 以外）は消さない
 */
export async function discardQueuedSiteAudit(db: Db, auditId: string): Promise<void> {
  await db.delete(siteAudit).where(and(eq(siteAudit.id, auditId), eq(siteAudit.status, 'queued')))
}

export type WeeklySiteAuditsResult = {
  created: number
  /** ジョブに渡す診断：その日の自動の診断で、まだ queued のものすべて（前回渡しそびれた分も拾い直す） */
  toDispatch: string[]
}

/**
 * 週 1 回の自動の診断を作る。対象は、ドメインを登録していて、自動計測がオンのブランド（デモ組織は除く）。
 * 何度呼んでも、1 ブランド 1 日 1 つ（DB の一意制約）。実行中の診断があるブランドは作らない
 */
export async function createScheduledSiteAudits(
  db: Db,
  date: string,
  modeFor: (organizationId: string) => SiteMode,
): Promise<WeeklySiteAuditsResult> {
  const brands = await db
    .select({
      id: brandTable.id,
      organizationId: brandTable.organizationId,
      domain: brandTable.domain,
      metadata: organization.metadata,
    })
    .from(brandTable)
    .innerJoin(organization, eq(organization.id, brandTable.organizationId))
    .where(and(eq(brandTable.scheduleEnabled, true), isNotNull(brandTable.domain)))
    .orderBy(brandTable.createdAt)

  let created = 0
  for (const b of brands) {
    if (isDemoMetadata(b.metadata) || !b.domain) continue
    const [row] = await db
      .insert(siteAudit)
      .values({
        brandId: b.id,
        trigger: 'scheduled',
        mode: modeFor(b.organizationId),
        requestedOn: date,
        domain: b.domain,
      })
      .onConflictDoNothing()
      .returning({ id: siteAudit.id })
    if (row) created += 1
  }

  const queued = await db
    .select({ id: siteAudit.id })
    .from(siteAudit)
    .where(
      and(
        eq(siteAudit.trigger, 'scheduled'),
        eq(siteAudit.requestedOn, date),
        eq(siteAudit.status, 'queued'),
      ),
    )
  return { created, toDispatch: queued.map((r) => r.id) }
}
