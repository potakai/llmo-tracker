import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { normalizeDatabaseUrl } from './url'

export function createDb(url: string) {
  const client = postgres(normalizeDatabaseUrl(url), { max: 10 })
  return drizzle(client, { schema, casing: 'snake_case' })
}

export type Db = ReturnType<typeof createDb>
