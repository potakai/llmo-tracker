import { OWN_CRAWLER_TOKEN } from './ai-crawlers'
import { isAllowedByRobotsState, parseRobotsTxt, type RobotsState } from './robots'
import { type FetchOptions, SiteFetchError, type SiteFetcher } from './types'

/** robots.txt として読む大きさの上限（RFC 9309 では、少なくとも 500 KiB は読むこと） */
export const MAX_ROBOTS_TXT_CHARS = 512 * 1024

/**
 * robots.txt を取りに行った結果（site_audit.site_facts にもこの形で残す）。
 * - found：2xx で読めた
 * - missing：4xx（RFC 9309 では、すべて読んでよい）
 * - unreachable：5xx や通信のエラー（RFC 9309 では、すべて止められているものとして扱う）。
 *   error は通信のエラーのとき（サイト自体に届かない）
 */
export type RobotsFetchResult =
  | { kind: 'found'; text: string }
  | { kind: 'missing' }
  | { kind: 'unreachable'; reason: string; error?: SiteFetchError }

/** そのオリジンの robots.txt を読む */
export async function readRobotsTxt(
  fetcher: SiteFetcher,
  origin: string,
): Promise<RobotsFetchResult> {
  let res: Awaited<ReturnType<SiteFetcher['fetch']>>
  try {
    res = await fetcher.fetch(`${origin}/robots.txt`)
  } catch (error) {
    if (!(error instanceof SiteFetchError)) throw error
    return { kind: 'unreachable', reason: error.message, error }
  }
  if (res.status >= 200 && res.status < 300) {
    return { kind: 'found', text: res.body.slice(0, MAX_ROBOTS_TXT_CHARS) }
  }
  if (res.status >= 400 && res.status < 500) return { kind: 'missing' }
  return { kind: 'unreachable', reason: `HTTP ${res.status}` }
}

export function toRobotsState(result: RobotsFetchResult): RobotsState {
  if (result.kind === 'found') return { kind: 'found', robots: parseRobotsTxt(result.text) }
  if (result.kind === 'missing') return { kind: 'missing' }
  return { kind: 'unreachable', reason: result.reason }
}

export type RobotsGuardedFetcher = SiteFetcher & {
  /** そのオリジンの robots.txt（オリジンごとに 1 回だけ読む） */
  robotsFor(origin: string): Promise<RobotsFetchResult>
}

export type RobotsGuardOptions = {
  /** robots.txt で照合する名前 */
  token?: string
  /** 読み取り済みの robots.txt（オリジンごと）。渡したオリジンは読み直さない */
  known?: [string, RobotsFetchResult][]
}

/**
 * robots.txt を守って読むもの。robots.txt 自体の取得を除き、すべてのリクエストの前に
 * （リダイレクト先も、そのたびに）、接続先のオリジン（スキーム・ホスト・ポート）の robots.txt を当てる。
 * このツールが止められていれば、そのリクエストは送らずに robots_disallowed で失敗する
 */
export function createRobotsGuardedFetcher(
  inner: SiteFetcher,
  options: RobotsGuardOptions = {},
): RobotsGuardedFetcher {
  const token = options.token ?? OWN_CRAWLER_TOKEN
  const cache = new Map<string, Promise<RobotsFetchResult>>(
    (options.known ?? []).map(([origin, result]) => [origin, Promise.resolve(result)]),
  )
  const robotsFor = (origin: string) => {
    let pending = cache.get(origin)
    if (!pending) {
      pending = readRobotsTxt(inner, origin)
      cache.set(origin, pending)
    }
    return pending
  }
  const gate = async (url: URL) => {
    if (url.pathname === '/robots.txt') return
    const state = toRobotsState(await robotsFor(url.origin))
    if (!isAllowedByRobotsState(state, token, url.href)) {
      throw new SiteFetchError('robots_disallowed', url.href)
    }
  }

  return {
    mode: inner.mode,
    robotsFor,
    fetch(url: string, fetchOptions: FetchOptions = {}) {
      return inner.fetch(url, {
        ...fetchOptions,
        beforeRequest: async (target) => {
          await fetchOptions.beforeRequest?.(target)
          await gate(target)
        },
      })
    },
  }
}
