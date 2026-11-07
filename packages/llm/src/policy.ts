import type { Extractor } from './extract/types'

/** live = 本物の AI（費用がかかる）、fake = フェイク（費用ゼロ。動作確認用の作り物の回答） */
export type LlmMode = 'live' | 'fake'

type Env = Record<string, string | undefined>

export type LlmPolicy<P> = {
  /** その組織で本物の AI を使うか */
  modeFor(organizationId: string): LlmMode
  /** その組織で使う AI（プロバイダーと抽出器）。live / fake それぞれ最初に使うときに 1 回だけ作る */
  llmFor(organizationId: string): { mode: LlmMode; providers: P; extractor: Extractor }
}

/**
 * どの組織で本物の AI を使うか。両方を満たすときだけ live、それ以外はすべて fake：
 * - LLM_MODE=live
 * - LIVE_ORGANIZATION_IDS（カンマ区切り）にその組織の ID がある。`*` ならすべての組織
 *
 * 公開している本番では誰でもサインアップしてブランドを登録できるので、
 * 許可した組織（自分の組織）だけが API の費用を発生させられるようにする。
 * 許可の一覧は環境変数に置く（組織の metadata はユーザーが Better Auth の API で書き換えられるため使わない）。
 */
export function liveModeFor(env: Env): (organizationId: string) => LlmMode {
  if (env.LLM_MODE !== 'live') return () => 'fake'
  const allowed = new Set(
    (env.LIVE_ORGANIZATION_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
  if (allowed.has('*')) return () => 'live'
  return (organizationId) => (allowed.has(organizationId) ? 'live' : 'fake')
}

/**
 * live / fake の AI を作る関数を受け取って、組織ごとに使い分けるポリシーを作る。
 * 作る関数を外から渡すのは、テストで本物の API キーなしに確かめるため。
 */
export function createLlmPolicyWith<P>(
  env: Env,
  build: (mode: LlmMode) => { providers: P; extractor: Extractor },
): LlmPolicy<P> {
  const modeFor = liveModeFor(env)
  const built = new Map<LlmMode, { providers: P; extractor: Extractor }>()
  return {
    modeFor,
    llmFor(organizationId) {
      const mode = modeFor(organizationId)
      let llm = built.get(mode)
      if (!llm) {
        llm = build(mode)
        built.set(mode, llm)
      }
      return { mode, ...llm }
    },
  }
}
