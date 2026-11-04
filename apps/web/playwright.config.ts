import { defineConfig, devices } from '@playwright/test'

/**
 * ブラウザで画面を通しで確かめる E2E テスト。
 * 手元では `pnpm dev` を立ち上げて（起動済みならそれを使って）、開発用の DB に対して動かす。
 * CI では、ビルド済みのアプリを `next start` で立ち上げて動かす（本番と同じ動きを確かめる）。
 *   pnpm --filter web test:e2e
 * 初回だけブラウザのインストールが必要： pnpm --filter web exec playwright install chromium
 */
const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // pnpm dev は初回アクセス時にページをコンパイルするので、待ち時間を長めにする
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ja-JP',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: {
    command: isCI ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
