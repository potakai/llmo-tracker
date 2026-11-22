import {
  abandonRun,
  createDailyRuns,
  dbNow,
  executeRunSlice,
  RunNotFoundError,
  recoverStaleRuns,
  tokyoDate,
} from '@llmo/runner'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { getLlmPolicy } from '@/lib/llm'
import { inngest } from './client'
import { createRunRequestedEvent, runRequested } from './events'

// ジョブの中身はすべて packages/runner にある。ここはそれを Inngest のステップに載せるだけ

/**
 * 1 ステップで、新しい質問・抽出を始めてよい時間。予算を使い切っても投げ途中の質問は待つので、
 * 1 ステップは最長で これ + 質問のタイムアウト（120 秒）+ DB の読み書き くらいかかる。
 * 1 回のリクエストの長さは /api/inngest の maxDuration のコメントを参照
 */
const SLICE_BUDGET_MS = 45_000
/** API のレート制限と費用を抑えるため、同時に動かす run の数。Hobby プランの上限（5）より小さくする */
const MAX_CONCURRENT_RUNS = 3

/**
 * run を 1 つ処理する（AI に聞いて保存し、言及を抽出する）。
 * executeRunSlice を done になるまでステップごとに呼ぶ。どのステップで落ちても、次は DB の続きから再開する。
 */
export const executeRunFunction = inngest.createFunction(
  {
    id: 'execute-run',
    triggers: [runRequested],
    concurrency: [{ limit: MAX_CONCURRENT_RUNS }, { key: 'event.data.runId', limit: 1 }],
    // リトライを使い切ったら、run を途中のまま終わらせる（30 分待たずに次の実行ができるように）
    onFailure: async ({ event, logger }) => {
      const runId = event.data.event.data.runId
      const closed = await abandonRun(db, runId)
      if (closed) logger.warn('ジョブが失敗したので run を終わらせました', closed)
    },
  },
  async ({ event, step, logger }) => {
    const { runId } = event.data
    // この時刻より前に失敗していた回答だけを聞き直す（関数のやり直しでも同じ値を使うよう、ステップで覚えておく）
    const retryFailedBefore = new Date(await step.run('start', () => dbNow(db)))
    const deps = { db, llmFor: getLlmPolicy().llmFor }

    for (let slice = 1; ; slice += 1) {
      const result = await step.run(`slice-${slice}`, async () => {
        try {
          return await executeRunSlice(deps, runId, {
            budgetMs: SLICE_BUDGET_MS,
            retryFailedBefore,
          })
        } catch (error) {
          // run が消えている（ブランドの削除など）ならリトライしない
          if (error instanceof RunNotFoundError) throw new NonRetriableError(error.message)
          throw error
        }
      })
      if (result.done) {
        logger.info('run が終わりました', result.summary)
        return result.summary
      }
    }
  },
)

/**
 * 毎日の自動実行（毎朝 6 時、日本時間）。ブランドごとにその日の run を作って execute-run に渡す。
 * イベントの ID が run ごとに決まっているので、リトライで二重に送っても execute-run は 1 回しか動かない
 */
export const dailyRunsFunction = inngest.createFunction(
  { id: 'daily-runs', triggers: [{ cron: 'TZ=Asia/Tokyo 0 6 * * *' }] },
  async ({ event, step, logger }) => {
    const date = tokyoDate(new Date(event.ts ?? Date.now()))
    const result = await step.run('create-daily-runs', () => createDailyRuns(db, date))
    if (result.toDispatch.length > 0) {
      await step.sendEvent('dispatch-runs', result.toDispatch.map(createRunRequestedEvent))
    }

    const summary = {
      date,
      created: result.created.length,
      skipped: result.skipped,
      dispatched: result.toDispatch.length,
      // 拾い直す前に自動計測がオフにされていて、配信せずに取り消した run
      cancelled: result.cancelled.length,
    }
    logger.info('今日の run を作りました', summary)
    return summary
  },
)

/**
 * 止まった run の回収（10 分ごと）。30 分なにも進んでいない queued / running の run を終わらせる。
 * ジョブが落ちた・イベントを送る前に失敗したなどで残った run が、次の実行を止め続けないようにする。
 */
export const recoverStaleRunsFunction = inngest.createFunction(
  { id: 'recover-stale-runs', triggers: [{ cron: '*/10 * * * *' }] },
  async ({ step, logger }) => {
    const recovered = await step.run('recover-stale-runs', () => recoverStaleRuns(db))
    if (recovered.length > 0) logger.warn('止まっていた run を終わらせました', { recovered })
    return { recovered: recovered.length }
  },
)

export const functions = [executeRunFunction, dailyRunsFunction, recoverStaleRunsFunction]
