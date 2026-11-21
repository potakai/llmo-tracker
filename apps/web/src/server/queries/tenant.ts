import { brand } from '@llmo/db'
import { eq, inArray, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'

/**
 * テナントの境界：brand_id の列が、その組織のブランドを指しているか（brand.organization_id で絞る）。
 * アプリのデータを読むクエリは、呼び出し側で組織を確かめていても、必ずこれを条件に入れる
 */
export function inOrganization(brandIdColumn: AnyPgColumn, organizationId: string): SQL {
  return inArray(
    brandIdColumn,
    db.select({ id: brand.id }).from(brand).where(eq(brand.organizationId, organizationId)),
  )
}
