import 'server-only'
import type { SiteAuditDeps } from '@llmo/runner'
import { createSitePolicy, type SitePolicy } from '@llmo/site'
import { db } from '@/lib/db'

let policy: SitePolicy | undefined

/**
 * 組織ごとに本物のサイトとフェイクの HTML を使い分けるポリシー（SITE_MODE と LIVE_ORGANIZATION_IDS で決まる）。
 * 開発・テスト・CI は SITE_MODE を設定しないので、本物のサイトは読まない
 */
export function getSitePolicy(): SitePolicy {
  policy ??= createSitePolicy(process.env)
  return policy
}

/** サイト診断を動かすのに要るもの（packages/runner に渡す） */
export const siteAuditDeps = (): SiteAuditDeps => ({
  db,
  fetcherFor: getSitePolicy().fetcherFor,
  modeFor: getSitePolicy().modeFor,
})
