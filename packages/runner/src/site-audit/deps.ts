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
