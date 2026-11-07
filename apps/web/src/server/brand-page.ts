import 'server-only'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getLlmPolicy } from '@/lib/llm'
import { isDemoOrganization } from './demo'
import { AppError } from './errors'
import { findBrandInOrg } from './routes/brands'
import { brandParams } from './schemas/brand'
import { requireViewerWithOrg } from './viewer'

/**
 * ブランド配下の画面の共通処理：ログインと組織を確かめ、自分の組織のブランドでなければ 404。
 * レイアウトとページの両方から呼ばれるので、1 回のリクエストの中ではキャッシュする。
 */
export const loadBrandForPage = cache(async (rawBrandId: string) => {
  const { organizationId } = await requireViewerWithOrg()
  const parsed = brandParams.safeParse({ brandId: rawBrandId })
  if (!parsed.success) notFound()
  try {
    const [brand, isDemo] = await Promise.all([
      findBrandInOrg(organizationId, parsed.data.brandId),
      isDemoOrganization(organizationId),
    ])
    // 本物の AI で計測している組織か（それ以外はフェイクの回答で、数字は動作確認用）
    const llmMode = getLlmPolicy().modeFor(organizationId)
    return { brand, isDemo, llmMode }
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound()
    throw error
  }
})
