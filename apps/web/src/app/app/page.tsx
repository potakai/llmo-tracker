import { brand } from '@llmo/db'
import { asc, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireViewerWithOrg } from '@/server/viewer'

/** /app に来たら、最初のブランドの画面へ。ブランドがなければ初期設定へ */
export default async function AppHome() {
  const { organizationId } = await requireViewerWithOrg()
  const [first] = await db
    .select({ id: brand.id })
    .from(brand)
    .where(eq(brand.organizationId, organizationId))
    .orderBy(asc(brand.createdAt))
    .limit(1)
  redirect(first ? `/app/brands/${first.id}` : '/onboarding')
}
