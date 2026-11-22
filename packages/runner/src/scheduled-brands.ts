import { brand as brandTable, type Db, organization, prompt as promptTable } from '@llmo/db'
import { and, eq, exists, isNull, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/** organization.metadata に `{"demo":true}` が入っている組織はデモ（閲覧専用） */
export function isDemoMetadata(metadata: string | null): boolean {
  if (!metadata) return false
  try {
    return JSON.parse(metadata)?.demo === true
  } catch {
    return false
  }
}

export type ScheduledBrand = { id: string; organizationId: string }

/**
 * 毎朝の自動計測の対象のブランド（作った順）。AI の計測と Google の検索で同じ条件を使う：
 * - 自動計測がオン（schedule_enabled = true）
 * - デモ組織ではない（閲覧専用で、計測すると費用がかかるため）
 * - 有効な（アーカイブしていない）質問が 1 つ以上ある。promptCondition を渡すと、それを満たす質問に限る
 */
export async function listScheduledBrands(
  db: Db,
  promptCondition?: SQL,
): Promise<ScheduledBrand[]> {
  const rows = await db
    .select({
      id: brandTable.id,
      organizationId: brandTable.organizationId,
      metadata: organization.metadata,
    })
    .from(brandTable)
    .innerJoin(organization, eq(organization.id, brandTable.organizationId))
    .where(
      and(
        eq(brandTable.scheduleEnabled, true),
        exists(
          db
            .select({ one: promptTable.id })
            .from(promptTable)
            .where(activePromptsOf(brandTable.id, promptCondition)),
        ),
      ),
    )
    .orderBy(brandTable.createdAt)
  return rows
    .filter((b) => !isDemoMetadata(b.metadata))
    .map(({ id, organizationId }) => ({ id, organizationId }))
}

/** そのブランドの有効な質問（promptCondition があれば、それも満たすもの） */
export function activePromptsOf(
  brandId: AnyPgColumn | string,
  promptCondition?: SQL,
): SQL | undefined {
  return and(eq(promptTable.brandId, brandId), isNull(promptTable.archivedAt), promptCondition)
}
