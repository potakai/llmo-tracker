import { organization } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'

/** デモ組織の目印。organization.metadata に JSON で入れておく */
export const DEMO_METADATA = JSON.stringify({ demo: true })

/** デモ組織か（デモは閲覧専用で、計測も編集もできない） */
export async function isDemoOrganization(organizationId: string): Promise<boolean> {
  const [org] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!org?.metadata) return false
  try {
    return JSON.parse(org.metadata)?.demo === true
  } catch {
    return false
  }
}
