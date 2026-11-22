import { describe, expect, it } from 'vitest'
import {
  buildFakeSerpResult,
  buildTaskPostBody,
  createDataForSeoProvider,
  createFakeSerpProvider,
  parseSerpResult,
  SerpApiError,
} from '../src'

/** DataForSEO の task_get/advanced の result[0] に似せた結果（ドキュメントの項目名どおり） */
const organic = (rank: number, domain: string) => ({
  type: 'organic',
  rank_group: rank,
  rank_absolute: rank + 1,
  domain,
  url: `https://${domain}/page`,
  title: `${domain} のページ`,
})

const aiOverview = (asynchronous: boolean) => ({
  type: 'ai_overview',
  rank_group: 1,
  rank_absolute: 1,
  asynchronous_ai_overview: asynchronous,
  markdown: '会計ソフトなら **◯◯会計** と 競合A が人気です。',
  items: [
    {
      type: 'ai_overview_element',
      title: null,
      text: '会計ソフトなら◯◯会計と競合Aが人気です。',
      markdown: '会計ソフトなら **◯◯会計** と 競合A が人気です。',
      references: [
        {
          type: 'ai_overview_reference',
          source: '比較ナビ',
          domain: 'hikaku.example',
          url: 'https://hikaku.example/a',
          title: '比較記事',
          text: '...',
        },
      ],
    },
  ],
  references: [
    {
      type: 'ai_overview_reference',
      source: '比較ナビ',
      domain: 'hikaku.example',
      url: 'https://hikaku.example/a',
      title: '比較記事',
      text: '...',
    },
    {
      type: 'ai_overview_reference',
      source: '公式',
      domain: 'maru.example.com',
      url: 'https://maru.example.com/',
      title: null,
      text: '...',
    },
  ],
})

describe('parseSerpResult', () => {
  it('自然検索の順位（rank_group）を取り出し、広告などほかの種類の項目は無視する', () => {
    const serp = parseSerpResult({
      items: [
        { type: 'paid', rank_group: 1, rank_absolute: 1, domain: 'ad.example', url: 'x' },
        organic(1, 'www.Maru.Example.com'),
        organic(2, 'kyougou-a.example'),
      ],
    })
    expect(serp.organic).toEqual([
      expect.objectContaining({ rank: 1, rankAbsolute: 2, domain: 'www.maru.example.com' }),
      expect.objectContaining({ rank: 2, domain: 'kyougou-a.example' }),
    ])
    expect(serp.aiOverview).toBeNull()
  })

  it('AI による概要がない結果では、aiOverview は null', () => {
    expect(parseSerpResult({ items: [organic(1, 'a.example')] }).aiOverview).toBeNull()
  })

  it('AI による概要の本文と引用元を取り出す。同じ URL の引用元は 1 つにまとめる', () => {
    const serp = parseSerpResult({ items: [aiOverview(false), organic(1, 'a.example')] })
    expect(serp.aiOverview).toEqual({
      asynchronous: false,
      text: '会計ソフトなら **◯◯会計** と 競合A が人気です。',
      references: [
        { url: 'https://hikaku.example/a', title: '比較記事' },
        { url: 'https://maru.example.com/', title: null },
      ],
    })
  })

  it('あとから読み込まれる（asynchronous）AI による概要も取り出し、その印を残す', () => {
    const serp = parseSerpResult({ items: [aiOverview(true)] })
    expect(serp.aiOverview?.asynchronous).toBe(true)
    expect(serp.aiOverview?.text).toContain('◯◯会計')
  })

  it('markdown がなければ、要素の本文をつなげて本文にする', () => {
    const serp = parseSerpResult({
      items: [
        {
          type: 'ai_overview',
          asynchronous_ai_overview: true,
          markdown: null,
          items: [
            { type: 'ai_overview_element', title: '見出し', text: '本文1' },
            { type: 'ai_overview_element', title: null, text: '本文2' },
          ],
        },
      ],
    })
    expect(serp.aiOverview?.text).toBe('見出し\n本文1\n\n本文2')
  })

  it('形の合わない項目と、items のない結果では落ちない', () => {
    expect(parseSerpResult({ items: [{ type: 'organic', rank_group: 'x' }, null] })).toEqual({
      organic: [],
      aiOverview: null,
    })
    expect(parseSerpResult(null)).toEqual({ organic: [], aiOverview: null })
    expect(parseSerpResult({ items: null })).toEqual({ organic: [], aiOverview: null })
  })
})

describe('buildTaskPostBody', () => {
  it('日本（2392）・日本語（ja）・上位 10 件で、あとから読み込まれる AI による概要も取る', () => {
    expect(buildTaskPostBody('会計ソフト おすすめ', 'serp-1')).toEqual({
      keyword: '会計ソフト おすすめ',
      location_code: 2392,
      language_code: 'ja',
      device: 'desktop',
      depth: 10,
      load_async_ai_overview: true,
      tag: 'serp-1',
    })
  })
})

/** 決まった応答を返す fetch。呼ばれたリクエストを覚えておく */
function stubFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const body = responses.shift()
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const envelope = (task: Record<string, unknown>) => ({
  version: '0.1.20260101',
  status_code: 20000,
  status_message: 'Ok.',
  time: '0.1 sec.',
  cost: task.cost ?? 0,
  tasks_count: 1,
  tasks_error: 0,
  tasks: [{ time: '0.1 sec.', result_count: 0, path: [], data: {}, ...task }],
})

describe('createDataForSeoProvider', () => {
  it('task_post：Basic 認証で 1 件のタスクを送り、task ID と費用を返す', async () => {
    const stub = stubFetch([
      envelope({ id: 'task-1', status_code: 20100, status_message: 'Task Created.', cost: 0.0012 }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })

    const posted = await provider.postTask({ keyword: 'クラウド会計', tag: 't' })

    expect(posted).toEqual({ taskId: 'task-1', costUsd: 0.0012 })
    const [call] = stub.calls
    expect(call?.url).toBe('https://api.dataforseo.com/v3/serp/google/organic/task_post')
    expect(call?.init.method).toBe('POST')
    expect(new Headers(call?.init.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('me:pw').toString('base64')}`,
    )
    expect(JSON.parse(String(call?.init.body))).toEqual([buildTaskPostBody('クラウド会計', 't')])
  })

  it('task_post：タスクが作られなければ、エラーにする（費用の行方が分からない ID を残さない）', async () => {
    const stub = stubFetch([
      envelope({ id: 'x', status_code: 40501, status_message: 'Invalid Field.', cost: 0 }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })
    await expect(provider.postTask({ keyword: 'a' })).rejects.toThrow(SerpApiError)
  })

  it('全体のエラー（認証の失敗・残高不足など）と HTTP のエラーは、例外にする', async () => {
    const stub = stubFetch([
      { status_code: 40100, status_message: 'You are not authorized.', tasks: null },
      new Response('oops', { status: 500 }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })
    await expect(provider.postTask({ keyword: 'a' })).rejects.toThrow(/not authorized/)
    await expect(provider.postTask({ keyword: 'a' })).rejects.toThrow(/HTTP 500/)
  })

  it('task_get：処理中（40601 / 40602）なら pending を返す', async () => {
    const stub = stubFetch([
      envelope({ id: 'task-1', status_code: 40601, status_message: 'Task Handed.' }),
      envelope({ id: 'task-1', status_code: 40602, status_message: 'Task In Queue.' }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })
    expect(await provider.fetchTask({ taskId: 'task-1', keyword: 'a' })).toEqual({
      status: 'pending',
    })
    expect(await provider.fetchTask({ taskId: 'task-1', keyword: 'a' })).toEqual({
      status: 'pending',
    })
    expect(stub.calls[0]?.url).toBe(
      'https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced/task-1',
    )
  })

  it('task_get：終わっていれば、順位と AI による概要を取り出し、生の結果も返す', async () => {
    const result = { keyword: 'a', items: [aiOverview(true), organic(1, 'maru.example.com')] }
    const stub = stubFetch([
      envelope({ id: 'task-1', status_code: 20000, status_message: 'Ok.', result: [result] }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })

    const fetched = await provider.fetchTask({ taskId: 'task-1', keyword: 'a' })

    expect(fetched.status).toBe('ready')
    if (fetched.status !== 'ready') return
    expect(fetched.raw).toEqual(result)
    expect(fetched.serp.organic[0]?.domain).toBe('maru.example.com')
    expect(fetched.serp.aiOverview?.asynchronous).toBe(true)
  })

  it('task_get：検索結果が 0 件（40102）なら、順位も AI による概要もない結果として扱う', async () => {
    const stub = stubFetch([
      envelope({ id: 'task-1', status_code: 40102, status_message: 'No Search Results.' }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })
    const fetched = await provider.fetchTask({ taskId: 'task-1', keyword: 'a' })
    expect(fetched).toMatchObject({ status: 'ready', serp: { organic: [], aiOverview: null } })
  })

  it('task_get：タスクのエラーは例外にする', async () => {
    const stub = stubFetch([
      envelope({ id: 'task-1', status_code: 40400, status_message: 'Not Found.' }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })
    await expect(provider.fetchTask({ taskId: 'task-1', keyword: 'a' })).rejects.toThrow(
      /Not Found/,
    )
  })
})

describe('createDataForSeoProvider のエラー（障害か、タスク自体のエラーか）', () => {
  /** 例外を受け取って返す */
  async function caught(promise: Promise<unknown>): Promise<SerpApiError> {
    try {
      await promise
    } catch (error) {
      if (error instanceof SerpApiError) return error
      throw error
    }
    throw new Error('例外にならなかった')
  }

  it('HTTP のエラー・応答の形の違い・全体のエラーは、障害（request）として、中身の分かるメッセージにする', async () => {
    const stub = stubFetch([
      new Response('Bad Gateway', { status: 502 }),
      { unexpected: true },
      { status_code: 50000, status_message: 'Internal Error.', tasks: null },
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })
    const fetch = () => provider.fetchTask({ taskId: 'task-1', keyword: 'a' })

    const http = await caught(fetch())
    expect(http).toMatchObject({ scope: 'request', statusCode: null })
    expect(http.message).toMatch(/HTTP 502/)

    const shape = await caught(fetch())
    expect(shape).toMatchObject({ scope: 'request', statusCode: null })
    expect(shape.message).toMatch(/応答の形が想定と違います.*status_code/)

    const envelope = await caught(fetch())
    expect(envelope).toMatchObject({ scope: 'request', statusCode: 50000 })
    expect(envelope.message).toMatch(/Internal Error/)
  })

  it('タスク自体のエラー（取り直しても同じ）は、task として返す', async () => {
    const stub = stubFetch([
      envelope({ id: 'task-1', status_code: 40400, status_message: 'Not Found.' }),
      envelope({ id: 'x', status_code: 40501, status_message: 'Invalid Field.', cost: 0 }),
    ])
    const provider = createDataForSeoProvider({ login: 'me', password: 'pw', fetch: stub.fetch })

    expect(await caught(provider.fetchTask({ taskId: 'task-1', keyword: 'a' }))).toMatchObject({
      scope: 'task',
      statusCode: 40400,
    })
    expect(await caught(provider.postTask({ keyword: 'a' }))).toMatchObject({
      scope: 'task',
      statusCode: 40501,
    })
  })
})

describe('フェイクの DataForSEO', () => {
  const hints = {
    brand: { name: '◯◯会計', domain: 'maru.example.com' },
    competitors: [
      { name: '競合A', domain: 'kyougou-a.example' },
      { name: '競合B', domain: null },
    ],
  }

  it('本物と同じ形の結果を作り、同じ取り出し処理で読める。同じタスクなら同じ結果', async () => {
    const provider = createFakeSerpProvider()
    const { taskId, costUsd } = await provider.postTask({ keyword: '会計ソフト' })
    expect(costUsd).toBe(0)

    const first = await provider.fetchTask({ taskId, keyword: '会計ソフト', fakeHints: hints })
    const second = await provider.fetchTask({ taskId, keyword: '会計ソフト', fakeHints: hints })
    expect(first).toEqual(second)
    expect(first.status).toBe('ready')
    if (first.status !== 'ready') return
    expect(first.serp.organic).toHaveLength(10)
    expect(first.serp.organic.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('いろいろな検索語で、AI による概要が出る結果・出ない結果・あとから読み込まれる結果がそろう', () => {
    const parsed = Array.from({ length: 40 }, (_, i) =>
      parseSerpResult(buildFakeSerpResult(`検索語${i}`, hints, `seed-${i}`)),
    )
    expect(parsed.some((s) => s.aiOverview === null)).toBe(true)
    expect(parsed.some((s) => s.aiOverview?.asynchronous === true)).toBe(true)
    expect(parsed.some((s) => s.aiOverview?.asynchronous === false)).toBe(true)
    // ドメインが未設定の競合は、順位に出てこない
    expect(parsed.some((s) => s.organic.some((o) => o.domain.includes('maru.example.com')))).toBe(
      true,
    )
  })
})
