import { describe, expect, it } from 'vitest'
import {
  isAllowedByRobots,
  isAllowedByRobotsState,
  isSiteBlockedFor,
  parseRobotsTxt,
} from '../src/robots'

const URL_BASE = 'https://example.com'
const allowed = (text: string, agent: string, path: string) =>
  isAllowedByRobots(parseRobotsTxt(text), agent, `${URL_BASE}${path}`)

describe('robots.txt の解釈', () => {
  it('名前の合う User-agent のグループがあると、そのグループの Disallow だけが当てはまる', () => {
    const text = [
      'User-agent: *',
      'Disallow: /private/',
      '',
      'User-agent: GPTBot',
      'Disallow: /',
    ].join('\n')
    expect(allowed(text, 'GPTBot', '/')).toBe(false)
    expect(allowed(text, 'GPTBot', '/blog')).toBe(false)
    // GPTBot のグループがあるので、* の /private/ は GPTBot には当てはまらない（グループは混ぜない）
    expect(allowed(text, 'ClaudeBot', '/blog')).toBe(true)
    expect(allowed(text, 'ClaudeBot', '/private/a')).toBe(false)
  })

  it('名前は大文字・小文字を区別せず、/1.0 のような版の部分は無視する', () => {
    const text = 'User-agent: gptbot/1.0\nDisallow: /'
    expect(allowed(text, 'GPTBot', '/')).toBe(false)
  })

  it('名前の合うグループがなければ * のグループ、それもなければ全部読んでよい', () => {
    expect(allowed('User-agent: *\nDisallow: /', 'PerplexityBot', '/a')).toBe(false)
    expect(allowed('User-agent: Googlebot\nDisallow: /', 'PerplexityBot', '/a')).toBe(true)
    expect(allowed('', 'PerplexityBot', '/a')).toBe(true)
  })

  it('空の Disallow は何も止めない', () => {
    const text = 'User-agent: GPTBot\nDisallow:\n\nUser-agent: *\nDisallow: /'
    expect(allowed(text, 'GPTBot', '/')).toBe(true)
    expect(allowed(text, 'GPTBot', '/any/page')).toBe(true)
  })

  it('User-agent が続くと同じグループになり、ルールのあとの User-agent は新しいグループになる', () => {
    const text = [
      'User-agent: GPTBot',
      'User-agent: CCBot',
      'Disallow: /',
      'User-agent: ClaudeBot',
      'Disallow: /tmp/',
    ].join('\n')
    expect(allowed(text, 'CCBot', '/')).toBe(false)
    expect(allowed(text, 'ClaudeBot', '/')).toBe(true)
    expect(allowed(text, 'ClaudeBot', '/tmp/x')).toBe(false)
  })

  it('同じ名前のグループが 2 つあれば、ルールをまとめる', () => {
    const text = 'User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b'
    expect(allowed(text, 'GPTBot', '/a')).toBe(false)
    expect(allowed(text, 'GPTBot', '/b')).toBe(false)
    expect(allowed(text, 'GPTBot', '/c')).toBe(true)
  })

  it('いちばん長く一致したルールが勝ち、同じ長さなら Allow が勝つ', () => {
    const text =
      'User-agent: *\nDisallow: /shop/\nAllow: /shop/public/\nDisallow: /same\nAllow: /same'
    expect(allowed(text, 'x', '/shop/cart')).toBe(false)
    expect(allowed(text, 'x', '/shop/public/item')).toBe(true)
    expect(allowed(text, 'x', '/same')).toBe(true)
  })

  it('* は任意の文字列、末尾の $ は URL の終わりとして扱う', () => {
    const text = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session='
    expect(allowed(text, 'x', '/docs/a.pdf')).toBe(false)
    expect(allowed(text, 'x', '/docs/a.pdf?x=1')).toBe(true)
    expect(allowed(text, 'x', '/list?session=abc')).toBe(false)
    expect(allowed(text, 'x', '/list?page=2')).toBe(true)
  })

  it('コメントと前後の空白・CRLF の改行を読み飛ばし、日本語のパスも比べられる', () => {
    const text = 'User-agent: * # すべて\r\n  Disallow: /お知らせ/  # 古い\r\n'
    expect(allowed(text, 'x', '/お知らせ/1')).toBe(false)
    expect(allowed(text, 'x', `/${encodeURIComponent('お知らせ')}/1`)).toBe(false)
    expect(allowed(text, 'x', '/news')).toBe(true)
  })

  it('グループの外の Disallow や、知らない行は無視する', () => {
    const text = 'Disallow: /\nCrawl-delay: 10\nfoo bar\nUser-agent: *\nAllow: /'
    expect(allowed(text, 'x', '/a')).toBe(true)
  })

  it('Sitemap: の行を、グループの中でも外でも拾う', () => {
    const robots = parseRobotsTxt(
      'Sitemap: https://example.com/a.xml\nUser-agent: *\nDisallow:\nSitemap: https://example.com/b.xml\nsitemap: https://example.com/a.xml',
    )
    expect(robots.sitemaps).toEqual(['https://example.com/a.xml', 'https://example.com/b.xml'])
  })

  it('robots.txt 自体は、全部止められていても読んでよい', () => {
    expect(allowed('User-agent: *\nDisallow: /', 'x', '/robots.txt')).toBe(true)
  })
})

describe('robots.txt を取りに行った結果ごとの扱い', () => {
  it('robots.txt がない（4xx）なら全部読んでよく、読めない（5xx）なら全部止められているものとする', () => {
    expect(isAllowedByRobotsState({ kind: 'missing' }, 'GPTBot', `${URL_BASE}/a`)).toBe(true)
    expect(
      isAllowedByRobotsState({ kind: 'unreachable', reason: '503' }, 'GPTBot', `${URL_BASE}/a`),
    ).toBe(false)
  })

  it('トップページが止められていれば、サイト全体を止めているとみなす', () => {
    const robots = parseRobotsTxt(
      'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp/',
    )
    const state = { kind: 'found' as const, robots }
    expect(isSiteBlockedFor(state, 'GPTBot', URL_BASE)).toBe(true)
    expect(isSiteBlockedFor(state, 'ClaudeBot', URL_BASE)).toBe(false)
  })
})

describe('robots.txt のグループの区切り（RFC 9309 §2.2.4）', () => {
  it('User-agent の間に Sitemap: や知らない行があっても、同じグループのまま', () => {
    const text = [
      'User-agent: GPTBot',
      'Sitemap: https://example.com/sitemap.xml',
      'User-agent: CCBot',
      'Crawl-delay: 10',
      'User-agent: ClaudeBot',
      'Disallow: /',
    ].join('\n')
    for (const agent of ['GPTBot', 'CCBot', 'ClaudeBot']) {
      expect(allowed(text, agent, '/')).toBe(false)
    }
    expect(parseRobotsTxt(text).sitemaps).toEqual(['https://example.com/sitemap.xml'])
  })

  it('ルールのあとに Sitemap: があっても、そのあとのルールは同じグループに入る', () => {
    const text =
      'User-agent: GPTBot\nDisallow: /a\nSitemap: https://example.com/s.xml\nDisallow: /b'
    expect(allowed(text, 'GPTBot', '/b')).toBe(false)
  })
})

describe('パスの照合の速さ', () => {
  it('* がたくさんある長いパターンと長い URL でも、すぐに終わる', () => {
    const pattern = `/${'a*'.repeat(5000)}b`
    const text = `User-agent: *\nDisallow: ${pattern}\nDisallow: /${'*a'.repeat(5000)}$`
    const robots = parseRobotsTxt(text)
    const url = `${URL_BASE}/${'a'.repeat(200_000)}`
    const started = performance.now()
    expect(isAllowedByRobots(robots, 'x', url)).toBe(false)
    expect(isAllowedByRobots(robots, 'x', `${url}c`)).toBe(true)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('* と $ の組み合わせを正しく照合する', () => {
    const text = 'User-agent: *\nDisallow: /a*b*c$\nDisallow: /x*'
    expect(allowed(text, 'q', '/a-b-c')).toBe(false)
    expect(allowed(text, 'q', '/abcabc')).toBe(false)
    expect(allowed(text, 'q', '/a-b-c-d')).toBe(true)
    expect(allowed(text, 'q', '/acb')).toBe(true)
    expect(allowed(text, 'q', '/x')).toBe(false)
    expect(allowed(text, 'q', '/y')).toBe(true)
  })
})

describe('パーセントエンコードの扱い（RFC 9309 §2.2.2〜2.2.3）', () => {
  it('ルールの %2A は「* という文字」で、ワイルドカードにしない', () => {
    const text = 'User-agent: *\nDisallow: /a%2Ab'
    expect(allowed(text, 'x', '/a*b')).toBe(false)
    expect(allowed(text, 'x', '/a%2Ab')).toBe(false)
    expect(allowed(text, 'x', '/axxb')).toBe(true)
  })

  it('%24 で書いた $ は URL の $ と一致し、URL の終わりの意味にはならない', () => {
    const text = 'User-agent: *\nDisallow: /price%24'
    expect(allowed(text, 'x', '/price$')).toBe(false)
    expect(allowed(text, 'x', '/price$/more')).toBe(false)
    expect(allowed(text, 'x', '/price')).toBe(true)
  })

  it('%2F と %2f は同じで、エンコードした / は、ふつうの / とは別のものとして比べる', () => {
    const text = 'User-agent: *\nDisallow: /a%2fb'
    expect(allowed(text, 'x', '/a%2Fb')).toBe(false)
    expect(allowed(text, 'x', '/a/b')).toBe(true)
  })

  it('非予約文字のエンコード（%61 など）は、デコードしたものと同じとみなす', () => {
    expect(allowed('User-agent: *\nDisallow: /%61bc', 'x', '/abc')).toBe(false)
    expect(allowed('User-agent: *\nDisallow: /abc', 'x', '/%61bc')).toBe(false)
  })

  it('優先順位は、正規化したあとの長さで決まる', () => {
    // Allow は書いた文字数は長いが、正規化すると /abc（4 文字）。Disallow の /abc/（5 文字）が勝つ
    const text = 'User-agent: *\nAllow: /%61%62%63\nDisallow: /abc/'
    expect(allowed(text, 'x', '/abc/x')).toBe(false)
    // %24 の $ は 1 文字として数える：/x$（3 文字）が /x（2 文字）に勝つ
    const dollar = 'User-agent: *\nDisallow: /x\nAllow: /x%24'
    expect(allowed(dollar, 'x', '/x$')).toBe(true)
  })
})

describe('大きな robots.txt', () => {
  it('ルールと Sitemap: の行が数千行あっても、すぐに読み終わり、照合もすぐ終わる', () => {
    const lines = ['User-agent: *']
    for (let i = 0; i < 5000; i += 1) lines.push(`Disallow: /private-${i}/*.html$`)
    for (let i = 0; i < 20_000; i += 1) lines.push(`Sitemap: https://example.com/s-${i}.xml`)
    const started = performance.now()
    const robots = parseRobotsTxt(lines.join('\n'))
    for (let i = 0; i < 200; i += 1) isAllowedByRobots(robots, 'x', `${URL_BASE}/page-${i}`)
    expect(robots.sitemaps).toHaveLength(20_000)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
