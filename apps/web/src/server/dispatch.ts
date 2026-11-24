import { executeRun, executeSiteAudit } from '@llmo/runner'
import type { Inngest } from 'inngest'
import { after } from 'next/server'
import { inngest } from '@/inngest/client'
import { createRunRequestedEvent, createSiteAuditRequestedEvent } from '@/inngest/events'
import { db } from '@/lib/db'
import { getLlmPolicy } from '@/lib/llm'
import { siteAuditDeps } from '@/lib/site'

type Dispatcher = (id: string) => Promise<void> | void

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

/**
 * RUN_DISPATCH=inngest なら Inngest、未設定なら同じプロセスで実行する。
 * 開発モードかどうかは、Inngest の SDK がクライアントの環境変数から決めたもの（client.mode）をそのまま使う。
 * INNGEST_DEV=1 / true / URL なら開発モード、0 / false / 未設定なら cloud で、cloud ならイベントキーが要る
 */
export function selectDispatcher(
  env: Record<string, string | undefined> = process.env,
  client: Pick<Inngest, 'mode' | 'send'> = inngest,
): Dispatcher {
  return usesInngest(env, client) ? createInngestDispatcher(client) : dispatchInProcess
}

/**
 * サイト診断の投げ先。run と同じく RUN_DISPATCH=inngest なら Inngest（site-audit/requested）、
 * 未設定なら同じプロセスで動かす
 */
export function selectSiteAuditDispatcher(
  env: Record<string, string | undefined> = process.env,
  client: Pick<Inngest, 'mode' | 'send'> = inngest,
): Dispatcher {
  if (!usesInngest(env, client)) return dispatchSiteAuditInProcess
  return async (auditId) => {
    await client.send(createSiteAuditRequestedEvent(auditId))
  }
}

/** 開発用：レスポンスを返したあとに、同じプロセスでサイト診断を動かす */
export function dispatchSiteAuditInProcess(auditId: string): void {
  after(async () => {
    try {
      await executeSiteAudit(siteAuditDeps(), auditId)
      console.info('[site-audit] 終わりました', auditId)
    } catch (error) {
      console.error('[site-audit] 失敗', auditId, error)
    }
  })
}

function usesInngest(
  env: Record<string, string | undefined>,
  client: Pick<Inngest, 'mode'>,
): boolean {
  if (!env.RUN_DISPATCH) return false
  if (env.RUN_DISPATCH !== 'inngest') {
    throw new Error(`RUN_DISPATCH は未設定か inngest にしてください（${env.RUN_DISPATCH}）`)
  }
  if (client.mode !== 'dev' && !env.INNGEST_EVENT_KEY) {
    throw new Error(
      'RUN_DISPATCH=inngest には INNGEST_EVENT_KEY（手元では INNGEST_DEV=1）が必要です',
    )
  }
  return true
}
