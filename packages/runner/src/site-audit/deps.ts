import type { Db } from '@llmo/db'
import type { SiteFetcher, SiteMode, SiteTarget } from '@llmo/site'

export type SiteAuditDeps = {
  db: Db
  /** そのモードで、そのサイトを読むもの（packages/site の SitePolicy.fetcherFor） */
  fetcherFor: (mode: SiteMode, target: SiteTarget) => SiteFetcher
  /**
   * その組織が「今」本物のサイトを読んでよいか（packages/site の SitePolicy.modeFor）。
   * 診断を作ったあとに SITE_MODE や LIVE_ORGANIZATION_IDS が変わっても、保存した mode だけで本物を読まないように、
   * 読む直前に確かめる
   */
  modeFor: (organizationId: string) => SiteMode
  /** ページの間の待ち時間。テストで差し替える */
  sleep?: (ms: number) => Promise<void>
}

export class SiteAuditNotFoundError extends Error {
  constructor(readonly auditId: string) {
    super(`サイト診断が見つかりません: ${auditId}`)
  }
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const LIVE_NOT_ALLOWED_MESSAGE =
  '本物のサイトを読む許可がなくなったため、診断をやめました（もう一度診断すると、サンプルで診断します）'

/** 保存した mode のまま読んでよいか。live の診断は、その組織が今も本物を許可されているときだけ */
export function isModeStillAllowed(
  deps: Pick<SiteAuditDeps, 'modeFor'>,
  mode: SiteMode,
  organizationId: string,
): boolean {
  return mode === 'fake' || deps.modeFor(organizationId) === 'live'
}

export const DOMAIN_CHANGED_MESSAGE =
  'ブランドのドメインが変わった（または消えた）ため、古いドメインは読まずに診断をやめました'

/** 保存したドメインと、今のブランドのドメインが同じか（大文字・小文字と末尾の . だけをそろえる） */
export function isSameDomain(auditDomain: string, currentDomain: string | null): boolean {
  if (!currentDomain) return false
  const tidy = (value: string) => value.toLowerCase().replace(/\.$/, '')
  return tidy(auditDomain) === tidy(currentDomain)
}

/**
 * 読む直前に確かめる：今のブランドのドメインが診断を作ったときと同じか、本物を読む許可が今もあるか。
 * 続けてはいけなければ、診断を終える理由を返す
 */
export function stopReasonOf(
  deps: Pick<SiteAuditDeps, 'modeFor'>,
  audit: { mode: SiteMode; organizationId: string; domain: string; currentDomain: string | null },
): string | null {
  if (!isSameDomain(audit.domain, audit.currentDomain)) return DOMAIN_CHANGED_MESSAGE
  if (!isModeStillAllowed(deps, audit.mode, audit.organizationId)) return LIVE_NOT_ALLOWED_MESSAGE
  return null
}
