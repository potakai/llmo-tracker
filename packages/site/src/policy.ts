import { liveModeBySwitch } from '@llmo/llm'
import { createFakeSiteFetcher } from './fake'
import { createSafeFetcher } from './safe-fetch'
import type { SiteFetcher, SiteMode } from './types'

type Env = Record<string, string | undefined>

/** 読むサイト（ブランドに登録したドメイン）と、フェイクの本文に入れる名前 */
export type SiteTarget = { registeredDomain: string; brandName: string }

export type SitePolicy = {
  /** その組織で本物のサイトを読むか */
  modeFor(organizationId: string): SiteMode
  /** そのモードで、そのサイトを読むもの。読める範囲はそのドメイン（とサブドメイン）だけ */
  fetcherFor(mode: SiteMode, target: SiteTarget): SiteFetcher
}

/**
 * どの組織で本物のサイトを読むか。ほかの外部 API と同じく、両方を満たすときだけ live、それ以外はすべて fake：
 * - SITE_MODE=live
 * - LIVE_ORGANIZATION_IDS にその組織の ID がある（許可の一覧は AI・DataForSEO と共通）
 */
export function createSitePolicyWith(
  env: Env,
  build: (mode: SiteMode, target: SiteTarget) => SiteFetcher,
): SitePolicy {
  return { modeFor: liveModeBySwitch(env.SITE_MODE, env), fetcherFor: build }
}

export function createSitePolicy(env: Env): SitePolicy {
  return createSitePolicyWith(env, (mode, target) =>
    mode === 'live'
      ? createSafeFetcher({ registeredDomain: target.registeredDomain })
      : createFakeSiteFetcher(target),
  )
}
