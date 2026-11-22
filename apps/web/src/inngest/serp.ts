import {
  claimDailySerpTasks,
  collectSerpResults,
  giveUpSerpTasks,
  postSerpTasks,
  type SerpDeps,
  tokyoDate,
  waitAndCollectSerpResults,
} from '@llmo/runner'
import { db } from '@/lib/db'
import { getLlmPolicy } from '@/lib/llm'
import { getSerpPolicy } from '@/lib/serp'
import { inngest } from './client'

// 中身はすべて packages/runner にある。ここはそれを Inngest のステップに載せるだけ

/**
 * 1 ステップで、新しい呼び出しを始めてよい時間。予算を使い切っても呼び出し途中のものは待つので、
 * 1 ステップは最長で これ + DataForSEO のタイムアウト（60 秒）+ 抽出のタイムアウト（60 秒）くらい。
 * execute-run の slice（45 秒 + 120 秒）と同じ長さに収まる（/api/inngest の maxDuration を参照）
 */
const SLICE_BUDGET_MS = 45_000
/**
 * 頼んでから結果を取りに行くまで・取りに行く間隔。Standard queue は平均 5 分ほどで結果が出る
 * （https://dataforseo.com/pricing/google-serp/google-organic-serp-api）。step.sleep の間は関数は動いていないので、
 * 待っている時間は関数の実行時間の上限に数えられない
 */
const WAIT_BETWEEN_COLLECTS = '5m'
/** 取りに行く回数の上限。5 分 × 12 回 = 1 時間（Standard queue の目標は 45 分以内） */
const MAX_COLLECT_ROUNDS = 12

const serpDeps = (): SerpDeps => ({
  db,
  serp: getSerpPolicy(),
  extractorFor: (organizationId) => getLlmPolicy().llmFor(organizationId).extractor,
})

/**
 * 毎朝の Google の検索（日本時間 6 時）。キーワードの質問ごとに DataForSEO に検索を頼み、数分待って結果を取りに行く。
 *
 * AI の計測（daily-runs → execute-run）とは別の関数にしている：
 * - 片方が失敗しても、もう片方は進む（DataForSEO が止まっても AI の計測は続く。逆も同じ）
 * - 結果を待つ step.sleep のあいだ、execute-run の同時実行の枠を使わない
 *
 * 二重に課金しないように：
 * - 行は (キーワード, 日付) で一意。関数のやり直しでも、同じ日のキーワードは 1 回しか頼まない
 * - task ID は待つ前に DB に保存し、やり直しのときは保存した ID で結果を取りに行く
 */
export const serpDailyFunction = inngest.createFunction(
  {
    id: 'serp-daily',
    triggers: [{ cron: 'TZ=Asia/Tokyo 0 6 * * *' }],
    // 同じ日の検索が 2 つ同時に動かないようにする（頼む行の確保は DB でも守っている）
    concurrency: [{ limit: 1 }],
    // リトライを使い切ったら、その日の結果待ちの行を終わらせる（理由つきの失敗として残す）
    onFailure: async ({ event, logger }) => {
      const date = tokyoDate(new Date(event.data.event.ts ?? Date.now()))
      const closed = await giveUpSerpTasks(db, date)
      if (closed > 0)
        logger.warn('ジョブが失敗したので、Google の検索を終わらせました', { date, closed })
    },
  },
  async ({ event, step, logger }) => {
    const date = tokyoDate(new Date(event.ts ?? Date.now()))
    const { claimed } = await step.run('claim', () =>
      claimDailySerpTasks(db, date, getSerpPolicy().modeFor),
    )

    for (let slice = 1; ; slice += 1) {
      const posted = await step.run(`post-${slice}`, () =>
        postSerpTasks(serpDeps(), date, { budgetMs: SLICE_BUDGET_MS }),
      )
      if (posted.remaining === 0) break
    }

    // 待って取りに行く、を最大 MAX_COLLECT_ROUNDS 回。1 回のラウンドではカーソルを進めて全部の行を 1 回ずつ確かめる
    const { rounds, pending } = await waitAndCollectSerpResults(
      {
        run: async (name, fn) => (await step.run(name, fn)) as Awaited<ReturnType<typeof fn>>,
        sleep: (name) => step.sleep(name, WAIT_BETWEEN_COLLECTS),
      },
      (after) => collectSerpResults(serpDeps(), date, { budgetMs: SLICE_BUDGET_MS, after }),
      { maxRounds: MAX_COLLECT_ROUNDS },
    )

    const gaveUp = await step.run('give-up', () => giveUpSerpTasks(db, date))
    const summary = { date, claimed, rounds, pending, gaveUp }
    logger.info('Google の検索が終わりました', summary)
    return summary
  },
)
