import { createDb, type Db } from '@llmo/db'
import { createLlmPolicy, type LlmPolicy, type Providers } from '@llmo/llm'

let db: Db | undefined
let policy: LlmPolicy<Providers> | undefined

/** DB の接続。ワーカーの中で 1 つを使い回す */
export function getDb(): Db {
  const url = process.env.DATABASE_URL
  if (!url)
    throw new Error(
      '環境変数 DATABASE_URL が設定されていません（Trigger.dev のダッシュボードで設定）',
    )
  db ??= createDb(url)
  return db
}

/**
 * 組織ごとに使う AI を選ぶ。本物の AI を使うのは LLM_MODE=live かつ LIVE_ORGANIZATION_IDS にある組織だけ。
 * それ以外はフェイク（API キーなしで動き、費用もかからない）
 */
export function getLlmPolicy(): LlmPolicy<Providers> {
  policy ??= createLlmPolicy(process.env)
  return policy
}
