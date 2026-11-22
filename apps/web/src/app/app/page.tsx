import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { CURRENT_BRAND_COOKIE } from '@/server/current-brand'
import { resolveHomeBrandId } from '@/server/queries/brands'
import { requireViewerWithOrg } from '@/server/viewer'

/** /app に来たら、最後に見たブランド（なければ最初のブランド）の画面へ。ブランドがなければ初期設定へ */
export default async function AppHome() {
  const { organizationId } = await requireViewerWithOrg()
  const remembered = (await cookies()).get(CURRENT_BRAND_COOKIE)?.value
  const brandId = await resolveHomeBrandId(organizationId, remembered)
  redirect(brandId ? `/app/brands/${brandId}` : '/onboarding')
}
