import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OWN_USER_AGENT } from '../src/ai-crawlers'
import { createSafeFetcher, type Resolver, type SafeFetcherOptions } from '../src/safe-fetch'
import { SiteFetchError, type SiteFetchErrorReason } from '../src/types'

/**
 * 手元（127.0.0.1）に HTTP サーバーを立てる。届いたリクエストを覚えておき、
 * 「読まない」はずの場面で、接続そのものが起きていないことを確かめる
 */
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void
const routes = new Map<string, Handler>()
const hits: { host: string; path: string; userAgent: string }[] = []
let server: http.Server
let port: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push({
      host: req.headers.host ?? '',
      path: req.url ?? '',
      userAgent: req.headers['user-agent'] ?? '',
    })
    const handler = routes.get(req.url ?? '')
    if (handler) handler(req, res)
    else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = String((server.address() as AddressInfo).port)
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  routes.clear()
  hits.length = 0
})

const DOMAIN = 'maru.example.com'

/** 名前解決の差し替え。書いていない名前は解決できない */
function resolverOf(table: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = []
  const resolve = async (hostname: string) => {
    calls.push(hostname)
    const addresses = table[hostname]
    if (!addresses) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
  return Object.assign(resolve, { calls })
}

async function reasonOf(promise: Promise<unknown>): Promise<SiteFetchErrorReason> {
  try {
    await promise
  } catch (error) {
    if (error instanceof SiteFetchError) return error.reason
    throw error
  }
  throw new Error('読めてしまった')
}

describe('SSRF の対策：読まないもの（IP の確認は本番と同じ）', () => {
  // ポートだけはテストのサーバーに合わせる。IP の確認は本番と同じ（差し替えない）
  const fetcher = (options: Partial<SafeFetcherOptions> & { registeredDomain: string }) =>
    createSafeFetcher({ allowedPorts: new Set([port]), ...options })

  it('localhost は名前解決すると 127.0.0.1 になるので、接続しない', async () => {
    routes.set('/', (_req, res) => res.end('secret'))
    const reason = await reasonOf(
      fetcher({ registeredDomain: 'localhost' }).fetch(`http://localhost:${port}/`),
    )
    expect(reason).toBe('blocked_address')
    expect(hits).toHaveLength(0)
  })

  it.each([
    ['127.0.0.1', (p: string) => `http://127.0.0.1:${p}/`],
    ['127.0.0.1', (p: string) => `http://2130706433:${p}/`],
    ['127.0.0.1', (p: string) => `http://0x7f.0.0.1:${p}/`],
    ['[::1]', (p: string) => `http://[::1]:${p}/`],
  ])('URL に直接書いたプライベートの IP（%s）には接続しない', async (domain, url) => {
    routes.set('/', (_req, res) => res.end('secret'))
    const reason = await reasonOf(fetcher({ registeredDomain: domain }).fetch(url(port)))
    expect(reason).toBe('blocked_address')
    expect(hits).toHaveLength(0)
  })

  it.each([
    ['10.0.0.5'],
    ['192.168.0.10'],
    ['169.254.169.254'],
    ['::1'],
    ['fd00:ec2::254'],
    ['::ffff:127.0.0.1'],
  ])('ブランドのドメインが %s に名前解決されたら、接続しない', async (address) => {
    const resolve = resolverOf({ [DOMAIN]: [address] })
    const reason = await reasonOf(
      fetcher({ registeredDomain: DOMAIN, resolve }).fetch(`http://${DOMAIN}:${port}/`),
    )
    expect(reason).toBe('blocked_address')
    expect(resolve.calls).toEqual([DOMAIN])
  })

  it('名前解決の結果に、公開のアドレスとプライベートのアドレスが混ざっていたら、接続しない', async () => {
    const resolve = resolverOf({ [DOMAIN]: ['93.184.215.14', '127.0.0.1'] })
    const reason = await reasonOf(
      fetcher({ registeredDomain: DOMAIN, resolve }).fetch(`http://${DOMAIN}:${port}/`),
    )
    expect(reason).toBe('blocked_address')
  })

  it('確かめた名前解決のとおりに接続する（127.0.0.1 に解決される名前は、サーバーに届かない）', async () => {
    // 手元のサーバーは 127.0.0.1 で待っている。名前解決の確認を通らずに接続していれば、ここに届く
    routes.set('/', (_req, res) => res.end('secret'))
    const resolve = resolverOf({ [DOMAIN]: ['127.0.0.1'] })
    await reasonOf(
      fetcher({ registeredDomain: DOMAIN, resolve }).fetch(`http://${DOMAIN}:${port}/`),
    )
    expect(hits).toHaveLength(0)
  })

  it.each([
    'https://evil.example/',
    `https://${DOMAIN}.evil.test/`,
    'https://badmaru.example.com/',
    'file:///etc/passwd',
    `ftp://${DOMAIN}/`,
    `https://user:pass@${DOMAIN}/`,
    `https://${DOMAIN}:8080/`,
  ])(
    '登録したドメインの外や、http(s) 以外・ふつう以外のポート（%s）は、名前解決もしない',
    async (url) => {
      const resolve = resolverOf({})
      const reason = await reasonOf(
        createSafeFetcher({ registeredDomain: DOMAIN, resolve }).fetch(url),
      )
      expect(reason).toBe('outside_site')
      expect(resolve.calls).toHaveLength(0)
    },
  )

  it('URL として読めないものは読まない', async () => {
    const reason = await reasonOf(
      createSafeFetcher({ registeredDomain: DOMAIN }).fetch('not a url'),
    )
    expect(reason).toBe('invalid_url')
  })
})

describe('読み方（手元のサーバーを、ブランドのドメインとして読む）', () => {
  // 手元のサーバー（127.0.0.1）だけを特別に許可する
  const resolve = resolverOf({
    [DOMAIN]: ['127.0.0.1'],
    [`www.${DOMAIN}`]: ['127.0.0.1'],
    [`internal.${DOMAIN}`]: ['10.0.0.1'],
    'evil.example': ['127.0.0.1'],
  })
  const fetcher = (options: Partial<SafeFetcherOptions> = {}) =>
    createSafeFetcher({
      registeredDomain: DOMAIN,
      resolve,
      isAllowedAddress: (address) => address === '127.0.0.1',
      allowedPorts: new Set([port]),
      ...options,
    })
  const site = (path: string, host = DOMAIN) => `http://${host}:${port}${path}`

  it('ページを読み、このツールと分かる User-Agent を送り、Shift_JIS も読める', async () => {
    routes.set('/sjis', (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=Shift_JIS',
        'x-robots-tag': 'noindex',
      })
      // 「会計」を Shift_JIS で
      res.end(Buffer.from([0x89, 0xef, 0x8c, 0x76]))
    })
    const page = await fetcher().fetch(site('/sjis'))
    expect(page).toMatchObject({ status: 200, body: '会計', xRobotsTag: 'noindex' })
    expect(hits[0]?.userAgent).toBe(OWN_USER_AGENT)
  })

  it('同じサイトの中（サブドメインを含む）のリダイレクトはたどる', async () => {
    routes.set('/old', (_req, res) =>
      res.writeHead(301, { location: site('/new', `www.${DOMAIN}`) }).end(),
    )
    routes.set('/new', (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('ok'))
    const page = await fetcher().fetch(site('/old'))
    expect(page).toMatchObject({ status: 200, body: 'ok', url: site('/new', `www.${DOMAIN}`) })
  })

  it('外のドメインへのリダイレクトは、その先を読まない', async () => {
    routes.set('/out', (_req, res) =>
      res.writeHead(302, { location: site('/stolen', 'evil.example') }).end(),
    )
    const reason = await reasonOf(fetcher().fetch(site('/out')))
    expect(reason).toBe('outside_site')
    expect(hits.map((h) => h.path)).toEqual(['/out'])
  })

  it('プライベートの IP を直接指すリダイレクトは、その先を読まない', async () => {
    routes.set('/to-ip', (_req, res) =>
      res.writeHead(302, { location: `http://169.254.169.254/latest/meta-data/` }).end(),
    )
    const reason = await reasonOf(fetcher().fetch(site('/to-ip')))
    expect(reason).toBe('outside_site')
  })

  it('同じサイトでも、プライベートの IP に名前解決されるホストへのリダイレクトは読まない', async () => {
    routes.set('/to-internal', (_req, res) =>
      res.writeHead(302, { location: site('/admin', `internal.${DOMAIN}`) }).end(),
    )
    const reason = await reasonOf(fetcher().fetch(site('/to-internal')))
    expect(reason).toBe('blocked_address')
  })

  it('リダイレクトが多すぎたら、読むのをやめる', async () => {
    routes.set('/loop', (_req, res) => res.writeHead(302, { location: '/loop' }).end())
    const reason = await reasonOf(fetcher({ maxRedirects: 3 }).fetch(site('/loop')))
    expect(reason).toBe('too_many_redirects')
    expect(hits).toHaveLength(4)
  })

  it('大きすぎるページは、途中で読むのをやめる', async () => {
    routes.set('/big', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('a'.repeat(5000))
    })
    expect(await reasonOf(fetcher({ maxBytes: 1000 }).fetch(site('/big')))).toBe('too_large')
  })

  it('圧縮されたページは、展開したあとの大きさで上限を確かめる（圧縮爆弾を読まない）', async () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024))
    routes.set('/bomb', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
      res.end(bomb)
    })
    expect(bomb.length).toBeLessThan(10_000)
    expect(await reasonOf(fetcher({ maxBytes: 10_000 }).fetch(site('/bomb')))).toBe('too_large')
  })

  it('圧縮されたページを展開して読む', async () => {
    routes.set('/gz', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
      res.end(gzipSync('<h1>こんにちは</h1>'))
    })
    expect((await fetcher().fetch(site('/gz'))).body).toBe('<h1>こんにちは</h1>')
  })

  it('時間内に応答がなければ、読むのをやめる', async () => {
    routes.set('/slow', () => {
      // 応答しない
    })
    expect(await reasonOf(fetcher({ timeoutMs: 200 }).fetch(site('/slow')))).toBe('timeout')
  })

  it('HTML やテキストでないものは、本文を読まない', async () => {
    routes.set('/image', (_req, res) =>
      res.writeHead(200, { 'content-type': 'image/png' }).end('png'),
    )
    expect(await reasonOf(fetcher().fetch(site('/image')))).toBe('unsupported_type')
  })

  it('2xx 以外は、ステータスだけを返して本文は読まない', async () => {
    const page = await fetcher().fetch(site('/missing'))
    expect(page).toMatchObject({ status: 404, body: '' })
  })
})
