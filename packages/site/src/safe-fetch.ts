import { lookup as dnsLookup } from 'node:dns/promises'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import type { Readable } from 'node:stream'
import zlib from 'node:zlib'
import { OWN_USER_AGENT } from './ai-crawlers'
import { isPublicAddress, stripBrackets } from './ip'
import { DEFAULT_PORTS, toAuditableUrl } from './scope'
import { type FetchedResource, type FetchOptions, SiteFetchError, type SiteFetcher } from './types'

/** 1 回読むときの上限。ページの間の待ち時間と同時に読む数は、呼び出す側（packages/runner）で決める */
export const SITE_FETCH_LIMITS = {
  /** 1 つの URL を読むのにかける時間（リダイレクトを含む） */
  timeoutMs: 10_000,
  /** 1 ページの大きさ（展開したあと）。これを超えたら読むのをやめる */
  maxBytes: 2 * 1024 * 1024,
  /** リダイレクトをたどる回数 */
  maxRedirects: 5,
} as const

export type ResolvedAddress = { address: string; family: number }
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export type SafeFetcherOptions = {
  /** 読んでよいドメイン（ブランドに登録したもの）。サブドメインも読む */
  registeredDomain: string
  userAgent?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** 名前解決。テストで差し替える */
  resolve?: Resolver
  /** 接続してよい IP か。テストで手元のサーバーに接続するときだけ差し替える */
  isAllowedAddress?: (address: string) => boolean
  /** 接続してよいポート。テストで手元のサーバーに接続するときだけ差し替える */
  allowedPorts?: ReadonlySet<string>
}

const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1'
const TEXTUAL_TYPE = /^(text\/[\w.+-]+|application\/(xhtml\+xml|xml|[\w.-]+\+xml))$/

const defaultResolve: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })

/**
 * 本物のサイトを読むもの。SSRF を防ぐため、次のものは読まない：
 * - 登録したドメイン（とサブドメイン）の外。リダイレクトで外に出た場合も、その先は読まない
 * - http / https 以外、ユーザー名付きの URL、ふつう以外のポート
 * - 名前解決した IP（どれか 1 つでも）が、プライベート・ループバック・リンクローカル・メタデータなどのアドレス
 *
 * IP の確認は、接続に使う名前解決の中で行う（確かめたあとに別の IP に接続される DNS rebinding を防ぐ）。
 * URL に IP を直接書いた場合は名前解決が走らないので、接続の前に確かめる
 */
export function createSafeFetcher(options: SafeFetcherOptions): SiteFetcher {
  const limits = {
    timeoutMs: options.timeoutMs ?? SITE_FETCH_LIMITS.timeoutMs,
    maxBytes: options.maxBytes ?? SITE_FETCH_LIMITS.maxBytes,
    maxRedirects: options.maxRedirects ?? SITE_FETCH_LIMITS.maxRedirects,
  }
  const isAllowedAddress = options.isAllowedAddress ?? isPublicAddress
  const ports = options.allowedPorts ?? DEFAULT_PORTS
  const lookup = guardedLookup(options.resolve ?? defaultResolve, isAllowedAddress)
  const userAgent = options.userAgent ?? OWN_USER_AGENT

  const scoped = (raw: string, base?: string): URL => {
    if (!URL.canParse(raw, base)) throw new SiteFetchError('invalid_url', raw)
    const url = toAuditableUrl(raw, options.registeredDomain, { base, ports })
    if (!url) throw new SiteFetchError('outside_site', new URL(raw, base).href)
    return url
  }

  return {
    mode: 'live',
    async fetch(rawUrl: string, fetchOptions: FetchOptions = {}): Promise<FetchedResource> {
      const timeout = AbortSignal.timeout(limits.timeoutMs)
      const signal = fetchOptions.signal ? AbortSignal.any([timeout, fetchOptions.signal]) : timeout
      let current = scoped(rawUrl)
      for (let hop = 0; ; hop += 1) {
        assertLiteralAddressAllowed(current, isAllowedAddress)
        const result = await fetchOnce(current, { lookup, signal, userAgent, ...limits })
        if (result.kind === 'done') return result.resource
        if (hop >= limits.maxRedirects) throw new SiteFetchError('too_many_redirects', current.href)
        current = scoped(result.location, current.href)
      }
    },
  }
}

/** URL に IP を直接書いた場合（名前解決が走らない）は、ここで確かめる */
function assertLiteralAddressAllowed(url: URL, isAllowedAddress: (address: string) => boolean) {
  const host = stripBrackets(url.hostname)
  if (isIP(host) !== 0 && !isAllowedAddress(host)) {
    throw new SiteFetchError('blocked_address', host)
  }
}

/**
 * 接続に使う名前解決。解決した IP のどれか 1 つでも許可されていなければ、接続させない
 * （どの IP に接続するかは Node.js が選ぶので、全部を確かめる）
 */
export function guardedLookup(
  resolve: Resolver,
  isAllowedAddress: (address: string) => boolean,
): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    resolve(hostname).then(
      (all) => {
        const family = lookupOptions.family === 4 || lookupOptions.family === 6
        const addresses = family ? all.filter((a) => a.family === lookupOptions.family) : all
        if (addresses.length === 0) {
          callback(new SiteFetchError('dns', hostname), '', 0)
          return
        }
        const blocked = addresses.find((a) => !isAllowedAddress(a.address))
        if (blocked) {
          callback(new SiteFetchError('blocked_address', `${hostname} → ${blocked.address}`), '', 0)
          return
        }
        if (lookupOptions.all) {
          // all: true のときは配列を返す（Node.js の型定義は 1 つ返す形しか書いていない）
          ;(callback as unknown as (err: null, addresses: ResolvedAddress[]) => void)(
            null,
            addresses,
          )
          return
        }
        const [first] = addresses as [ResolvedAddress]
        callback(null, first.address, first.family)
      },
      (error: unknown) => {
        callback(new SiteFetchError('dns', `${hostname}: ${String(error)}`), '', 0)
      },
    )
  }
}

type Hop = { kind: 'redirect'; location: string } | { kind: 'done'; resource: FetchedResource }

type HopContext = {
  lookup: LookupFunction
  signal: AbortSignal
  userAgent: string
  maxBytes: number
}

function fetchOnce(url: URL, ctx: HopContext): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const fail = (error: unknown) => reject(toFetchError(error, ctx.signal))
    const client = url.protocol === 'https:' ? https : http
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': ctx.userAgent,
          accept: ACCEPT,
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'ja,en;q=0.8',
        },
        lookup: ctx.lookup,
        // 接続を使い回さない（使い回すと、確かめた名前解決を通らずに別のホストへ送ることがある）
        agent: false,
        signal: ctx.signal,
      },
      (res) => {
        res.on('error', fail)
        handleResponse(url, res, ctx).then(resolve, fail)
      },
    )
    req.on('error', fail)
    req.end()
  })
}

async function handleResponse(url: URL, res: IncomingMessage, ctx: HopContext): Promise<Hop> {
  const status = res.statusCode ?? 0
  const location = res.headers.location
  if (status >= 300 && status < 400 && location) {
    res.destroy()
    return { kind: 'redirect', location }
  }
  const contentType = res.headers['content-type'] ?? null
  const xRobotsTag = headerValue(res.headers['x-robots-tag'])
  const base = { url: url.href, status, contentType, xRobotsTag }
  if (status < 200 || status >= 300) {
    // エラーのページの本文は使わないので読まない
    res.destroy()
    return { kind: 'done', resource: { ...base, body: '' } }
  }
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase()
  if (mediaType && !TEXTUAL_TYPE.test(mediaType)) {
    res.destroy()
    throw new SiteFetchError('unsupported_type', mediaType)
  }
  const declaredLength = Number(res.headers['content-length'] ?? Number.NaN)
  if (Number.isFinite(declaredLength) && declaredLength > ctx.maxBytes) {
    res.destroy()
    throw new SiteFetchError('too_large', `${declaredLength} bytes`)
  }
  const bytes = await readLimited(decompress(res), ctx.maxBytes, () => res.destroy())
  return { kind: 'done', resource: { ...base, body: decodeBody(bytes, contentType) } }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

/** 圧縮された本文を展開する。展開したあとの大きさで上限を確かめる（圧縮爆弾を防ぐ） */
function decompress(res: IncomingMessage): Readable {
  const encoding = (res.headers['content-encoding'] ?? '').trim().toLowerCase()
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(zlib.createGunzip())
  if (encoding === 'deflate') return res.pipe(zlib.createInflate())
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress())
  return res
}

function readLimited(stream: Readable, maxBytes: number, abort: () => void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        abort()
        stream.destroy()
        reject(new SiteFetchError('too_large', `> ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/** 文字コード：Content-Type の charset → HTML の meta → UTF-8 の順に決める（Shift_JIS などのサイトのため） */
function decodeBody(bytes: Buffer, contentType: string | null): string {
  const label =
    charsetOf(contentType) ?? sniffMetaCharset(bytes.subarray(0, 2048).toString('latin1'))
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function charsetOf(contentType: string | null): string | null {
  return contentType?.match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ?? null
}

function sniffMetaCharset(head: string): string | null {
  return head.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1] ?? null
}

function toFetchError(error: unknown, signal: AbortSignal): SiteFetchError {
  if (error instanceof SiteFetchError) return error
  // 接続の名前解決で止めたとき、Node.js が別のエラーで包むことがある
  const cause = (error as { cause?: unknown } | null)?.cause
  if (cause instanceof SiteFetchError) return cause
  if (signal.aborted) return new SiteFetchError('timeout')
  const code = (error as { code?: string } | null)?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new SiteFetchError('dns', code)
  return new SiteFetchError('network', error instanceof Error ? error.message : String(error))
}
