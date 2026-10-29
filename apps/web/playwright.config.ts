import { defineConfig, devices } from '@playwright/test'

/**
 * ブラウザで画面を通しで確かめる E2E テスト。
 * 本物の `pnpm dev` を立ち上げて（起動済みならそれを使って）、開発用の DB に対して動かす。
 *   pnpm --filter web test:e2e
 * 初回だけブラウザのインストールが必要： pnpm --filter web exec playwright install chromium
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // pnpm dev は初回アクセス時にページをコンパイルするので、待ち時間を長めにする
  expect: { timeout: 20_000 },
  fullyParallel: false,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ja-JP',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
