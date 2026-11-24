import { describe, expect, it } from 'vitest'
import { OWN_CRAWLER_TOKEN } from '../src/ai-crawlers'
import { createRobotsGuardedFetcher } from '../src/robots-gate'
import { type FetchedResource, SiteFetchError, type SiteFetcher } from '../src/types'

const ORIGIN = 'https://maru.example.com'

/** URL ごとに中身を決めたサイト。読んだ URL を覚えておく */
function stub(pages: Record<string, Partial<FetchedResource> | SiteFetchError>) {
  const fetched: string[] = []
  const fetcher: SiteFetcher = {
    mode: 'fake',
    async fetch(url, options) {
      await options?.beforeRequest?.(new URL(url))
      fetched.push(url)
      const page = pages[url]
      if (page instanceof SiteFetchError) throw page
      return {
        url,
        status: page ? 200 : 404,
        contentType: 'text/html',
        xRobotsTag: null,
        body: '',
        ...page,
      }
    },
  }
  return { fetcher, fetched }
}

async function reasonOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof SiteFetchError) return error.reason
    throw error
  }
  return 'read'
}

describe('すべてのリクエストの前に robots.txt を当てる', () => {
  it('このツールが止められているページは、読まない', async () => {
    const { fetcher, fetched } = stub({
      [`${ORIGIN}/robots.txt`]: { body: `User-agent: ${OWN_CRAWLER_TOKEN}\nDisallow: /private` },
      [`${ORIGIN}/open`]: { body: 'ok' },
    })
    const guarded = createRobotsGuardedFetcher(fetcher)
    expect(await reasonOf(guarded.fetch(`${ORIGIN}/private/a`))).toBe('robots_disallowed')
    expect(await reasonOf(guarded.fetch(`${ORIGIN}/open`))).toBe('read')
    // robots.txt はオリジンごとに 1 回だけ読む
    expect(fetched).toEqual([`${ORIGIN}/robots.txt`, `${ORIGIN}/open`])
  })

  it('robots.txt が 5xx なら、すべて止められているものとして何も読まない', async () => {
    const { fetcher, fetched } = stub({ [`${ORIGIN}/robots.txt`]: { status: 503 } })
    const guarded = createRobotsGuardedFetcher(fetcher)
    for (const path of ['/', '/llms.txt', '/sitemap.xml']) {
      expect(await reasonOf(guarded.fetch(`${ORIGIN}${path}`))).toBe('robots_disallowed')
    }
    expect(fetched).toEqual([`${ORIGIN}/robots.txt`])
  })

  it('robots.txt を取れない（通信のエラー）ときも、何も読まない', async () => {
    const { fetcher, fetched } = stub({ [`${ORIGIN}/robots.txt`]: new SiteFetchError('timeout') })
    const guarded = createRobotsGuardedFetcher(fetcher)
    expect(await reasonOf(guarded.fetch(`${ORIGIN}/`))).toBe('robots_disallowed')
    expect(fetched).toEqual([`${ORIGIN}/robots.txt`])
  })

  it('robots.txt が 4xx なら、すべて読んでよい', async () => {
    const { fetcher } = stub({ [`${ORIGIN}/`]: { body: 'top' } })
    expect((await createRobotsGuardedFetcher(fetcher).fetch(`${ORIGIN}/`)).body).toBe('top')
  })

  it('オリジン（スキーム・ホスト・ポート）ごとに、その robots.txt を当てる', async () => {
    const blog = 'https://blog.maru.example.com'
    const { fetcher, fetched } = stub({
      [`${ORIGIN}/robots.txt`]: { body: '' },
      [`${blog}/robots.txt`]: { body: 'User-agent: *\nDisallow: /' },
      [`${ORIGIN}/a`]: { body: 'a' },
    })
    const guarded = createRobotsGuardedFetcher(fetcher)
    expect(await reasonOf(guarded.fetch(`${ORIGIN}/a`))).toBe('read')
    expect(await reasonOf(guarded.fetch(`${blog}/a`))).toBe('robots_disallowed')
    expect(await reasonOf(guarded.fetch('http://maru.example.com/a'))).toBe('read')
    expect(fetched).toContain('http://maru.example.com/robots.txt')
  })

  it('読み取り済みの robots.txt を渡せば、読み直さない', async () => {
    const { fetcher, fetched } = stub({ [`${ORIGIN}/a`]: { body: 'a' } })
    const guarded = createRobotsGuardedFetcher(fetcher, {
      known: [[ORIGIN, { kind: 'found', text: 'User-agent: *\nDisallow: /b' }]],
    })
    expect(await reasonOf(guarded.fetch(`${ORIGIN}/b`))).toBe('robots_disallowed')
    expect(await reasonOf(guarded.fetch(`${ORIGIN}/a`))).toBe('read')
    expect(fetched).toEqual([`${ORIGIN}/a`])
  })
})
