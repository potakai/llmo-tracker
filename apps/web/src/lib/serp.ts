import 'server-only'
import { createSerpPolicy, type SerpPolicy } from '@llmo/serp'

let policy: SerpPolicy | undefined

/**
 * 組織ごとに本物の DataForSEO とフェイクを使い分けるポリシー（SERP_MODE と LIVE_ORGANIZATION_IDS で決まる）。
 * 最初に使うときに作る（フェイクの組織しか使わなければ、認証情報がなくても起動できる）
 */
export function getSerpPolicy(): SerpPolicy {
  policy ??= createSerpPolicy(process.env)
  return policy
}
