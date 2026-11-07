import { createDb, type Db } from '@llmo/db'
import {
  createExtractorFromEnv,
  createProvidersFromEnv,
  type Extractor,
  type Providers,
} from '@llmo/llm'

let db: Db | undefined
let llm: { providers: Providers; extractor: Extractor } | undefined

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

/** AI の呼び出しと抽出。LLM_MODE=fake なら API キーなしで動く */
export function getLlm() {
  llm ??= {
    providers: createProvidersFromEnv(process.env),
    extractor: createExtractorFromEnv(process.env),
  }
  return llm
}
