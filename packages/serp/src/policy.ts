import { liveModeBySwitch } from '@llmo/llm'
import { createDataForSeoProvider } from './dataforseo'
import { createFakeSerpProvider } from './fake'
import type { SerpMode, SerpProvider } from './types'

type Env = Record<string, string | undefined>

export type SerpPolicy = {
  /** その組織で本物の DataForSEO を使うか */
  modeFor(organizationId: string): SerpMode
  /**
   * そのモードのプロバイダー。最初に使うときに 1 回だけ作る。
   * 結果を取りに行くときは、頼んだときに保存したモードで選ぶ（途中で設定が変わっても取り違えない）
   */
  providerFor(mode: SerpMode): SerpProvider
}

/**
 * どの組織で本物の DataForSEO を使うか。両方を満たすときだけ live、それ以外はすべて fake：
 * - SERP_MODE=live（AI の LLM_MODE とは別。DataForSEO だけを止めたいとき、AI の計測に影響させない）
 * - LIVE_ORGANIZATION_IDS にその組織の ID がある（許可の一覧は AI と共通）
 */
export function createSerpPolicyWith(
  env: Env,
  build: (mode: SerpMode) => SerpProvider,
): SerpPolicy {
  const modeFor = liveModeBySwitch(env.SERP_MODE, env)
  const built = new Map<SerpMode, SerpProvider>()
  return {
    modeFor,
    providerFor(mode) {
      const existing = built.get(mode)
      if (existing) return existing
      const created = build(mode)
      built.set(mode, created)
      return created
    },
  }
}

export function createSerpPolicy(env: Env): SerpPolicy {
  return createSerpPolicyWith(env, (mode) => {
    if (mode === 'fake') return createFakeSerpProvider()
    const login = env.DATAFORSEO_LOGIN
    const password = env.DATAFORSEO_PASSWORD
    if (!login || !password) {
      throw new Error(
        'SERP_MODE=live には DATAFORSEO_LOGIN と DATAFORSEO_PASSWORD の両方が必要です',
      )
    }
    return createDataForSeoProvider({ login, password })
  })
}
