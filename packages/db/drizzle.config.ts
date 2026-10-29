import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '../../.env' })

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL が設定されていません（ルートの .env を確認）')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url },
  strict: true,
})
