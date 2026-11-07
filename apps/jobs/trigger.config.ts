import { defineConfig } from '@trigger.dev/sdk'

/**
 * Trigger.dev の設定。タスクは src/trigger/ に置く。
 *   pnpm --filter jobs dev     … 手元のタスクを Trigger.dev の開発環境につなぐ
 *   pnpm --filter jobs deploy  … 本番にデプロイ
 *
 * タスクが使う環境変数（DATABASE_URL、LLM_MODE、API キー）は、Trigger.dev のダッシュボードで環境ごとに設定する。
 */
export default defineConfig({
  project: 'proj_zluailfwmzuxkpzqgjcj',
  dirs: ['./src/trigger'],
  runtime: 'node-22',
  // 1 回の実行は 10 質問 × 2 AI × 5 回 = 100 件で数分。止まったものは recover-stale-runs が回収する
  maxDuration: 20 * 60,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 10_000,
      maxTimeoutInMs: 120_000,
      randomize: true,
    },
  },
})
