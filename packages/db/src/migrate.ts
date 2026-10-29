import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/** drizzle/ のマイグレーションを順に適用する（テストやデプロイから呼ぶ） */
export async function runMigrations(url: string, options: { reset?: boolean } = {}) {
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    if (options.reset) {
      // テスト用：スキーマごと消して作り直す
      await client.unsafe('drop schema if exists public cascade; create schema public;')
      await client.unsafe('drop schema if exists drizzle cascade;')
    }
    await migrate(drizzle(client), { migrationsFolder })
  } finally {
    await client.end()
  }
}
