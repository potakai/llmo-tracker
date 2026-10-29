import { runMigrations } from '@llmo/db/migrate'

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL が設定されていません（ルートの .env を確認）')
  await runMigrations(url, { reset: true })
}
