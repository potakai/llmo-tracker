import { describe, expect, it } from 'vitest'
import { createApp } from '@/server/app'
import { createInngestDispatcher, dispatchInProcess, selectDispatcher } from '@/server/dispatch'
import { TestClient } from './helpers'

/** Inngest のクライアントの代わり。送られたイベントを覚えておく */
function fakeInngest() {
  const sent: unknown[] = []
  return {
    sent,
    send: async (payload: unknown) => {
      sent.push(payload)
      return { ids: ['fake'] }
    },
  }
}

async function startRun(dispatchRun: Parameters<typeof createApp>[0]['dispatchRun']) {
  const client = new TestClient(createApp({ dispatchRun }))
  await client.signUp('grace')
  await client.createOrganization('Grace Inc')
  const { json } = await client.post('/api/brands', { name: '◯◯会計', prompts: ['質問'] })
  return client.post(`/api/brands/${json.brand.id}/runs`, {})
}

describe('Inngest への投げ先', () => {
  it('手動実行すると、run/requested イベントが id: run-<runId> で送られる', async () => {
    const inngest = fakeInngest()

    const res = await startRun(createInngestDispatcher(inngest))

    expect(res.status).toBe(202)
    const runId = res.json.run.id as string
    expect(inngest.sent).toEqual([
      expect.objectContaining({ name: 'run/requested', data: { runId }, id: `run-${runId}` }),
    ])
  })

  it('イベントを送れなかったら、503 を返して run を終わらせる', async () => {
    const res = await startRun(
      createInngestDispatcher({
        send: async () => {
          throw new Error('Inngest に接続できません')
        },
      }),
    )

    expect(res.status).toBe(503)
    expect(res.json.error.code).toBe('DISPATCH_FAILED')
  })
})

describe('投げ先の選び方', () => {
  it('RUN_DISPATCH が未設定なら、同じプロセスで実行する', () => {
    expect(selectDispatcher({})).toBe(dispatchInProcess)
  })

  it('RUN_DISPATCH=inngest でイベントキーも開発サーバーの指定もなければ、起動時に落とす', () => {
    expect(() => selectDispatcher({ RUN_DISPATCH: 'inngest' })).toThrow('INNGEST_EVENT_KEY')
  })

  it('RUN_DISPATCH=inngest でイベントキーがあれば、Inngest に送る', () => {
    const dispatcher = selectDispatcher({ RUN_DISPATCH: 'inngest', INNGEST_EVENT_KEY: 'key' })
    expect(dispatcher).not.toBe(dispatchInProcess)
  })

  it('RUN_DISPATCH が知らない値なら、起動時に落とす', () => {
    expect(() => selectDispatcher({ RUN_DISPATCH: 'trigger' })).toThrow('RUN_DISPATCH')
  })
})
