import { runMigrations } from '@llmo/db/migrate'

/** テストの前に、テスト用DBを空にしてマイグレーションを流し直す */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL が設定されていません')
  await runMigrations(url, { reset: true })
}
