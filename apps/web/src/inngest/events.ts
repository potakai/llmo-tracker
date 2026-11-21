import { eventType } from 'inngest'
import { z } from 'zod'

/** run を 1 つ処理してほしい、というイベント。Web（手動実行）と daily-runs が送り、execute-run が受け取る */
export const runRequested = eventType('run/requested', {
  schema: z.object({ runId: z.string() }),
})

/**
 * run/requested イベントを作る。ID は `run-<runId>`。Inngest は同じ ID のイベントを 24 時間は 1 回しか
 * 受け付けないので、その間に同じ run を二重に送っても execute-run は 1 回しか動かない
 */
export const createRunRequestedEvent = (runId: string) =>
  runRequested.create({ runId }, { id: `run-${runId}` })
