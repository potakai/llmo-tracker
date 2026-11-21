import { executeRun } from '@llmo/runner'
import { after } from 'next/server'
import { inngest } from '@/inngest/client'
import { createRunRequestedEvent } from '@/inngest/events'
import { db } from '@/lib/db'
import { getLlmPolicy } from '@/lib/llm'

type Dispatcher = (runId: string) => Promise<void> | void

/** イベントを送る相手。本番は Inngest のクライアント、テストでは差し替える */
export type EventSender = {
  send: (payload: ReturnType<typeof createRunRequestedEvent>) => Promise<unknown>
}

/**
 * 開発用：レスポンスを返したあとに、同じプロセスで run を実行する。
 * サーバーが落ちると run が途中で止まる。サーバーレス環境では実行時間の上限もあるので、本番は Inngest を使う。
 */
export function dispatchInProcess(runId: string): void {
  after(async () => {
    try {
      const summary = await executeRun({ db, llmFor: getLlmPolicy().llmFor }, runId)
      console.info('[run]', summary)
    } catch (error) {
      console.error('[run] 失敗', runId, error)
    }
  })
}

/**
 * 本番用：run/requested イベントを送り、Inngest の execute-run に処理させる。リトライや止まった run の回収は Inngest 側で行う。
 * イベントの ID が run ごとに決まっているので、同じ run を二重に送っても 1 回しか実行されない。
 */
export function createInngestDispatcher(sender: EventSender): Dispatcher {
  return async (runId) => {
    await sender.send(createRunRequestedEvent(runId))
  }
}

/** RUN_DISPATCH=inngest なら Inngest、未設定なら同じプロセスで実行する */
export function selectDispatcher(
  env: Record<string, string | undefined> = process.env,
): Dispatcher {
  if (!env.RUN_DISPATCH) return dispatchInProcess
  if (env.RUN_DISPATCH !== 'inngest') {
    throw new Error(`RUN_DISPATCH は未設定か inngest にしてください（${env.RUN_DISPATCH}）`)
  }
  // 開発サーバー（INNGEST_DEV）に送るときはキーがいらない
  if (!env.INNGEST_EVENT_KEY && !env.INNGEST_DEV) {
    throw new Error(
      'RUN_DISPATCH=inngest には INNGEST_EVENT_KEY（手元では INNGEST_DEV=1）が必要です',
    )
  }
  return createInngestDispatcher(inngest)
}
