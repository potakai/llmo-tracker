import { eventType } from 'inngest'
import { z } from 'zod'

/** run を 1 つ処理してほしい、というイベント。Web（手動実行）と daily-runs が送り、execute-run が受け取る */
export const runRequested = eventType('run/requested', {
  schema: z.object({ runId: z.string() }),
})

/**
 * イベントの ID。Inngest は同じ ID のイベントを 24 時間は 1 回しか受け付けないので、
 * 同じ run を二重に送っても execute-run は 1 回しか動かない
 */
export const runEventId = (runId: string): string => `run-${runId}`

/** run/requested イベントを作る（ID つき） */
export const createRunRequestedEvent = (runId: string) =>
  runRequested.create({ runId }, { id: runEventId(runId) })
