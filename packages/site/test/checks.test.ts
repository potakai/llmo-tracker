import { describe, expect, it } from 'vitest'
import { checkPage, checkSite, type SiteInput } from '../src/checks'
import { extractPageFacts, type PageFacts } from '../src/html'
import { parseRobotsTxt } from '../src/robots'

const ORIGIN = 'https://maru.example.com'

const site = (robots: string | null, overrides: Partial<SiteInput> = {}): SiteInput => ({
  origin: ORIGIN,
  robots: robots === null ? { kind: 'missing' } : { kind: 'found', robots: parseRobotsTxt(robots) },
  hasLlmsTxt: true,
  hasSitemap: true,
  pageUrls: [`${ORIGIN}/`, `${ORIGIN}/shop/a`],
  hasFaqSomewhere: true,
  ...overrides,
})
const byKey = <T extends { key: string }>(list: T[], key: string) => list.find((c) => c.key === key)

describe('サイト全体の診断', () => {
  it('AI の検索に使われるクローラーを止めていたら、要対応にして名前を出す', () => {
    const result = byKey(checkSite(site('User-agent: OAI-SearchBot\nDisallow: /')), 'ai_crawlers')
    expect(result?.status).toBe('critical')
    expect(result?.message).toContain('OAI-SearchBot')
    expect(result?.detail).toMatchObject({ blocked: ['OAI-SearchBot'] })
  })

  it('* で全部止めていたら、すべての AI のクローラーを止めているとみなす', () => {
    const result = byKey(checkSite(site('User-agent: *\nDisallow: /')), 'ai_crawlers')
    expect(result?.status).toBe('critical')
    expect(result?.detail?.blocked).toContain('PerplexityBot')
  })

  it('学習用のクローラーだけ・一部のページだけを止めていたら、注意にする', () => {
    const training = byKey(checkSite(site('User-agent: GPTBot\nDisallow: /')), 'ai_crawlers')
    expect(training?.status).toBe('warning')
    const partial = byKey(checkSite(site('User-agent: ClaudeBot\nDisallow: /shop/')), 'ai_crawlers')
    expect(partial).toMatchObject({
      status: 'warning',
      detail: { partiallyBlocked: ['ClaudeBot'] },
    })
  })

  it('どのクローラーにも止めているページ（管理画面など）は、AI のクローラーを止めているとはみなさない', () => {
    const result = byKey(checkSite(site('User-agent: *\nDisallow: /shop/')), 'ai_crawlers')
    expect(result).toMatchObject({ status: 'ok', detail: { blocked: [], partiallyBlocked: [] } })
  })

  it('AI のクローラーを止めていなければ問題なし。robots.txt がなくても問題なし', () => {
    expect(byKey(checkSite(site('User-agent: *\nDisallow:')), 'ai_crawlers')?.status).toBe('ok')
    const missing = checkSite(site(null))
    expect(byKey(missing, 'ai_crawlers')?.status).toBe('ok')
    expect(byKey(missing, 'robots_txt')?.status).toBe('ok')
  })

  it('robots.txt がサーバーのエラーで読めなければ、要対応にする', () => {
    const result = checkSite(site(null, { robots: { kind: 'unreachable', reason: '503' } }))
    expect(byKey(result, 'robots_txt')?.status).toBe('critical')
    expect(byKey(result, 'ai_crawlers')?.status).toBe('critical')
  })

  it('llms.txt・sitemap・よくある質問がなければ、注意にする', () => {
    const result = checkSite(
      site(null, { hasLlmsTxt: false, hasSitemap: false, hasFaqSomewhere: false }),
    )
    expect(result.map((c) => [c.key, c.status])).toEqual([
      ['robots_txt', 'ok'],
      ['ai_crawlers', 'ok'],
      ['llms_txt', 'warning'],
      ['sitemap', 'warning'],
      ['faq', 'warning'],
    ])
  })
})

const GOOD_HTML = `<html><head><title>機能一覧｜◯◯会計のクラウド会計ソフト</title>
<meta name="description" content="${'◯◯会計の機能を紹介します。'.repeat(5)}">
<link rel="canonical" href="https://www.maru.example.com/features/">
<script type="application/ld+json">{"@type":"Product"}</script></head>
<body><h1>機能一覧</h1><p>${'◯◯会計は中小企業向けの会計ソフトです。'.repeat(20)}</p></body></html>`

const page = (html: string, names = ['◯◯会計']) => {
  const url = `${ORIGIN}/features`
  return checkPage({ url, facts: extractPageFacts(html, { url, names }), names })
}

describe('ページごとの診断', () => {
  it('整ったページは、すべて問題なし', () => {
    const result = page(GOOD_HTML)
    expect(result.filter((c) => c.status !== 'ok')).toEqual([])
    expect(byKey(result, 'structured_data')?.message).toContain('Product')
  })

  it('title がなければ要対応、短すぎ・長すぎは注意', () => {
    expect(byKey(page('<p>x</p>'), 'title')?.status).toBe('critical')
    expect(byKey(page('<title>会社概要</title>'), 'title')?.status).toBe('warning')
    expect(byKey(page(`<title>${'あ'.repeat(61)}</title>`), 'title')?.status).toBe('warning')
  })

  it('noindex は要対応、壊れた JSON-LD は要対応、JSON-LD がなければ注意', () => {
    expect(byKey(page('<meta name="robots" content="noindex">'), 'noindex')?.status).toBe(
      'critical',
    )
    expect(
      byKey(page('<script type="application/ld+json">{bad}</script>'), 'structured_data')?.status,
    ).toBe('critical')
    expect(byKey(page('<p>x</p>'), 'structured_data')?.status).toBe('warning')
  })

  it('h1 がない・2 つ以上は注意。本文が短い・名前が出ない・canonical がない／別のページは注意', () => {
    const result = page('<h1>A</h1><h1>B</h1><p>短い</p>')
    expect(byKey(result, 'h1')?.status).toBe('warning')
    expect(byKey(result, 'body_text')?.status).toBe('warning')
    expect(byKey(result, 'brand_name')?.status).toBe('warning')
    expect(byKey(result, 'canonical')?.status).toBe('warning')
    const other = page('<link rel="canonical" href="https://maru.example.com/">')
    expect(byKey(other, 'canonical')).toMatchObject({
      status: 'warning',
      detail: { canonical: `${ORIGIN}/` },
    })
  })

  it('名前を渡さなければ、名前の項目は出さない。よくある質問はあるときだけ出す', () => {
    const result = page('<p>x</p>', [])
    expect(byKey(result, 'brand_name')).toBeUndefined()
    expect(byKey(result, 'faq')).toBeUndefined()
    const facts: PageFacts = { ...extractPageFacts('', { url: ORIGIN }), faq: 'json-ld' }
    expect(byKey(checkPage({ url: ORIGIN, facts, names: [] }), 'faq')?.status).toBe('ok')
  })
})
