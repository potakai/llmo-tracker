import { brand } from '@llmo/db'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandParams } from '../schemas/brand'
import { inOrganization } from './tenant'

/** 組織のブランドの一覧（ID と名前だけ）。登録した順 */
export async function listBrandsInOrganization(organizationId: string) {
  return db
    .select({ id: brand.id, name: brand.name })
    .from(brand)
    .where(inOrganization(brand.id, organizationId))
    .orderBy(asc(brand.createdAt), asc(brand.id))
}

/** 組織のブランドを 1 件（ID と名前だけ）。他の組織のものなら null */
export async function findBrandSummary(organizationId: string, brandId: string) {
  const [found] = await db
    .select({ id: brand.id, name: brand.name })
    .from(brand)
    .where(and(eq(brand.id, brandId), inOrganization(brand.id, organizationId)))
    .limit(1)
  return found ?? null
}

/**
 * /app で移動するブランド。覚えているブランド（Cookie）が自分の組織のものならそれ、
 * なければ最初に登録したブランド。ブランドがなければ null
 */
export async function resolveHomeBrandId(
  organizationId: string,
  rememberedBrandId: string | undefined,
): Promise<string | null> {
  const parsed = brandParams.safeParse({ brandId: rememberedBrandId })
  if (parsed.success) {
    const remembered = await findBrandSummary(organizationId, parsed.data.brandId)
    if (remembered) return remembered.id
  }
  const [first] = await listBrandsInOrganization(organizationId)
  return first?.id ?? null
}
