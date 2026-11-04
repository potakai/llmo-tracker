import {
  createExtractorFromEnv,
  createProvidersFromEnv,
  type Extractor,
  type Providers,
} from '@llmo/llm'
import { executeRun } from '@llmo/runner'
import { tasks } from '@trigger.dev/sdk'
import { EXECUTE_RUN_TASK_ID, executeRunKey, type executeRunTask } from 'jobs'
import { after } from 'next/server'
import { db } from '@/lib/db'

let deps: { providers: Providers; extractor: Extractor } | undefined
// 最初に使うときに作る（フェイクモードなら API キーがなくても起動できるように）
const getDeps = () => {
  deps ??= {
    providers: createProvidersFromEnv(process.env),
    extractor: createExtractorFromEnv(process.env),
  }
  return deps
}

/**
 * 開発用：レスポンスを返したあとに、同じプロセスで run を実行する。
 * サーバーが落ちると run が途中で止まる。サーバーレス環境では実行時間の上限もあるので、本番は Trigger.dev を使う。
 */
export function dispatchInProcess(runId: string) {
  after(async () => {
    try {
      const summary = await executeRun({ db, ...getDeps() }, runId)
      console.info('[run]', summary)
    } catch (error) {
      console.error('[run] 失敗', runId, error)
    }
  })
}

/**
 * 本番用：Trigger.dev の execute-run タスクに渡す。リトライや止まった run の回収はジョブ側で行う。
 * 同じ run を二重に渡しても、鍵（idempotencyKey）が同じなので 1 回しか実行されない。
 */
export async function dispatchViaTrigger(runId: string) {
  await tasks.trigger<typeof executeRunTask>(
    EXECUTE_RUN_TASK_ID,
    { runId },
    { idempotencyKey: await executeRunKey(runId) },
  )
}

/** RUN_DISPATCH=trigger なら Trigger.dev、それ以外（未設定）なら同じプロセスで実行する */
export function selectDispatcher(env: NodeJS.ProcessEnv = process.env) {
  if (env.RUN_DISPATCH === 'trigger') {
    if (!env.TRIGGER_SECRET_KEY) {
      throw new Error('RUN_DISPATCH=trigger には TRIGGER_SECRET_KEY が必要です')
    }
    return dispatchViaTrigger
  }
  return dispatchInProcess
}
