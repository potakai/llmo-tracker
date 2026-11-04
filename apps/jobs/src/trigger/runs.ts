import {
  abandonRun,
  createDailyRuns,
  executeRun,
  RunNotFoundError,
  recoverStaleRuns,
  tokyoDate,
} from '@llmo/runner'
import { AbortTaskRunError, logger, schedules, task } from '@trigger.dev/sdk'
import { getDb, getLlm } from '../deps'
import { EXECUTE_RUN_TASK_ID, executeRunKey } from '../keys'

export type ExecuteRunPayload = { runId: string }

/**
 * run を 1 つ処理する（AI に聞いて保存し、言及を抽出する）。
 * executeRun は成功済みの回答を聞き直さないので、途中で落ちてリトライされても続きから再開する。
 */
export const executeRunTask = task({
  id: EXECUTE_RUN_TASK_ID,
  // API のレート制限と費用を抑えるため、同時に動かす run は 3 つまで
  queue: { concurrencyLimit: 3 },
  run: async ({ runId }: ExecuteRunPayload) => {
    try {
      const summary = await executeRun({ db: getDb(), ...getLlm() }, runId)
      logger.info('run が終わりました', summary)
      return summary
    } catch (error) {
      // run が消えている（ブランドの削除など）ならリトライしない
      if (error instanceof RunNotFoundError) throw new AbortTaskRunError(error.message)
      throw error
    }
  },
  // リトライを使い切ったら、run を途中のまま終わらせる（30 分待たずに次の実行ができるように）
  onFailure: async ({ payload }) => {
    const closed = await abandonRun(getDb(), payload.runId)
    if (closed) logger.warn('ジョブが失敗したので run を終わらせました', closed)
  },
})

/**
 * 毎日の自動実行（毎朝 6 時、日本時間）。ブランドごとにその日の run を作って execute-run に渡す。
 * 本番環境だけで動かす（開発環境ではダッシュボードの Test から手で起動できる）。
 */
export const dailyRunsTask = schedules.task({
  id: 'daily-runs',
  cron: { pattern: '0 6 * * *', timezone: 'Asia/Tokyo', environments: ['PRODUCTION'] },
  machine: 'micro',
  run: async (payload) => {
    const date = tokyoDate(payload.timestamp)
    const result = await createDailyRuns(getDb(), date)

    for (let i = 0; i < result.toDispatch.length; i += 100) {
      const chunk = result.toDispatch.slice(i, i + 100)
      await executeRunTask.batchTrigger(
        await Promise.all(
          chunk.map(async (runId) => ({
            payload: { runId },
            options: { idempotencyKey: await executeRunKey(runId) },
          })),
        ),
      )
    }

    const summary = {
      date,
      created: result.created.length,
      skipped: result.skipped,
      dispatched: result.toDispatch.length,
    }
    logger.info('今日の run を作りました', summary)
    return summary
  },
})

/**
 * 止まった run の回収（10 分ごと）。30 分なにも進んでいない queued / running の run を終わらせる。
 * ワーカーが落ちた・ジョブに渡す前に失敗したなどで残った run が、次の実行を止め続けないようにする。
 */
export const recoverStaleRunsTask = schedules.task({
  id: 'recover-stale-runs',
  cron: { pattern: '*/10 * * * *', environments: ['PRODUCTION'] },
  machine: 'micro',
  run: async () => {
    const recovered = await recoverStaleRuns(getDb())
    if (recovered.length > 0) logger.warn('止まっていた run を終わらせました', { recovered })
    return { recovered: recovered.length }
  },
})
