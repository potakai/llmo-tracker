import 'server-only'
import { createLlmPolicy, type LlmPolicy, type Providers } from '@llmo/llm'

let policy: LlmPolicy<Providers> | undefined

/**
 * 組織ごとに本物の AI とフェイクを使い分けるポリシー（LLM_MODE と LIVE_ORGANIZATION_IDS で決まる）。
 * 最初に使うときに作る（フェイクの組織しか使わなければ、API キーがなくても起動できる）
 */
export function getLlmPolicy(): LlmPolicy<Providers> {
  policy ??= createLlmPolicy(process.env)
  return policy
}
