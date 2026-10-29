import 'server-only'
import { notFound } from 'next/navigation'
import { AppError } from './errors'
import { findBrandInOrg } from './routes/brands'
import { brandParams } from './schemas/brand'
import { requireViewerWithOrg } from './viewer'

/** ブランド配下の画面の共通処理：ログインと組織を確かめ、自分の組織のブランドでなければ 404 */
export async function loadBrandForPage(rawBrandId: string) {
  const { organizationId } = await requireViewerWithOrg()
  const parsed = brandParams.safeParse({ brandId: rawBrandId })
  if (!parsed.success) notFound()
  try {
    return await findBrandInOrg(organizationId, parsed.data.brandId)
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound()
    throw error
  }
}
