import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

config({ path: '../../.env', quiet: true })

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl)
  throw new Error('TEST_DATABASE_URL が設定されていません（ルートの .env を確認）')

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Server Component 以外から読むと落ちるモジュール。テストは Next.js の外なので空にする
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // アプリのコードからはテスト用DBが DATABASE_URL に見える
    env: {
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-00',
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
    // DB を共有するのでファイルは順番に流す
    fileParallelism: false,
  },
})
