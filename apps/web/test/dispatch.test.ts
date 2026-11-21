import { Inngest } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchInProcess, selectDispatcher } from '@/server/dispatch'
import { routeHandlerTarget, TestClient } from './helpers'

/**
 * 本番と同じ配線（app/api/[[...route]]/route.ts → selectDispatcher → Inngest のクライアント）を読み込み直す。
 * 差し替えるのは Inngest の SDK の send だけ
 */
async function loadProductionRoute(send: (payload: unknown) => Promise<unknown>) {
  vi.resetModules()
  const { inngest } = await import('@/inngest/client')
  const sendSpy = vi.spyOn(inngest, 'send').mockImplementation(send as typeof inngest.send)
  const route = await import('@/app/api/[[...route]]/route')
  return { client: new TestClient(routeHandlerTarget(route)), sendSpy }
}

async function createBrand(client: TestClient) {
  await client.signUp('grace')
  await client.createOrganization('Grace Inc')
  const { json } = await client.post('/api/brands', { name: '◯◯会計', prompts: ['質問'] })
  return json.brand.id as string
}

describe('RUN_DISPATCH=inngest のときの手動実行（本番と同じ配線）', () => {
  beforeEach(() => {
    vi.stubEnv('RUN_DISPATCH', 'inngest')
    vi.stubEnv('INNGEST_EVENT_KEY', 'test-event-key')
    vi.stubEnv('INNGEST_DEV', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('実行すると、返した run の ID の run/requested イベントが、id: run-<runId> でちょうど 1 件送られる', async () => {
    const { client, sendSpy } = await loadProductionRoute(async () => ({ ids: ['fake'] }))
    const brandId = await createBrand(client)

    const res = await client.post(`/api/brands/${brandId}/runs`, {})

    expect(res.status).toBe(202)
    const runId = res.json.run.id as string
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0]?.[0]).toMatchObject({
      name: 'run/requested',
      data: { runId },
      id: `run-${runId}`,
    })
    // 同じプロセスでは実行しないので、run は queued のまま Inngest を待つ
    const list = await client.get(`/api/brands/${brandId}/runs`)
    expect(list.json.runs[0]).toMatchObject({ id: runId, status: 'queued' })
  })

  it('イベントを送れなかったら、503 を返して run を終わらせ、すぐに次の実行ができる', async () => {
    let fail = true
    const { client } = await loadProductionRoute(async () => {
      if (fail) throw new Error('Inngest に接続できません')
      return { ids: ['fake'] }
    })
    const brandId = await createBrand(client)

    const res = await client.post(`/api/brands/${brandId}/runs`, {})
    expect(res.status).toBe(503)
    expect(res.json.error.code).toBe('DISPATCH_FAILED')
    const list = await client.get(`/api/brands/${brandId}/runs`)
    expect(list.json.runs[0].status).toBe('failed')

    fail = false
    const retry = await client.post(`/api/brands/${brandId}/runs`, {})
    expect(retry.status).toBe(202)
  })
})

describe('投げ先の選び方', () => {
  /** INNGEST_DEV を指定した Inngest のクライアント（開発モードかどうかは SDK が決める） */
  const clientWithDev = (value: string) =>
    new Inngest({ id: 'test' }).setEnvVars({ INNGEST_DEV: value })

  it('RUN_DISPATCH が未設定なら、同じプロセスで実行する', () => {
    expect(selectDispatcher({})).toBe(dispatchInProcess)
  })

  it('RUN_DISPATCH が知らない値なら、起動時に落とす', () => {
    expect(() => selectDispatcher({ RUN_DISPATCH: 'trigger' })).toThrow('RUN_DISPATCH')
  })

  it('RUN_DISPATCH=inngest でイベントキーがあれば、Inngest に送る', () => {
    const dispatcher = selectDispatcher(
      { RUN_DISPATCH: 'inngest', INNGEST_EVENT_KEY: 'key' },
      clientWithDev(''),
    )
    expect(dispatcher).not.toBe(dispatchInProcess)
  })

  it.each(['', '0', 'false', 'FALSE'])(
    'RUN_DISPATCH=inngest でイベントキーがなく、INNGEST_DEV=%j（SDK は cloud と判断）なら、起動時に落とす',
    (value) => {
      expect(() => selectDispatcher({ RUN_DISPATCH: 'inngest' }, clientWithDev(value))).toThrow(
        'INNGEST_EVENT_KEY',
      )
    },
  )

  it.each(['1', 'true', ' TRUE ', 'http://localhost:8288'])(
    'RUN_DISPATCH=inngest でイベントキーがなくても、INNGEST_DEV=%j（SDK は開発モードと判断）なら起動できる',
    (value) => {
      expect(() =>
        selectDispatcher({ RUN_DISPATCH: 'inngest' }, clientWithDev(value)),
      ).not.toThrow()
    },
  )
})
