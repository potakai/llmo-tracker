import { response } from '@llmo/db'
import { FAKE_MODEL_PREFIX, type LlmMode } from '@llmo/llm'
import { not, type SQL, sql } from 'drizzle-orm'

/**
 * フェイク（サンプルの AI）の回答か。`isFakeModel`（@llmo/llm）を SQL にしたもの。
 * 接頭辞に `%` や `_` は入らないので、そのまま LIKE のパターンにできる
 */
export const isFakeResponse = sql<boolean>`${response.model} like ${`${FAKE_MODEL_PREFIX}%`}`

/**
 * 集計・表示に使う回答の条件。
 * live の組織では、live にする前にサンプルの AI で計測した回答を外す（DB からは消さない）。
 * fake の組織（デモなど）は、フェイクの回答しかないので今までどおりすべて使う。
 * 組織の条件（brand をたどる）は呼び出し側で必ず別に付けること
 */
export function countedResponses(llmMode: LlmMode): SQL | undefined {
  return llmMode === 'live' ? not(isFakeResponse) : undefined
}
