import { describe, expect, it } from 'vitest'
import { parseSitemap } from '../src/sitemap'

describe('sitemap の読み取り', () => {
  it('urlset の <loc> を書かれた順に、重複を除いて取り出す', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc> https://example.com/ </loc></url>
      <url><loc>https://example.com/a?x=1&amp;y=2</loc></url>
      <url><loc>https://example.com/</loc></url></urlset>`
    expect(parseSitemap(xml)).toEqual({
      kind: 'urlset',
      urls: ['https://example.com/', 'https://example.com/a?x=1&y=2'],
    })
  })

  it('sitemapindex なら、ほかの sitemap の一覧として返す', () => {
    const xml =
      '<sm:sitemapindex><sm:sitemap><sm:loc>https://example.com/s1.xml</sm:loc></sm:sitemap></sm:sitemapindex>'
    expect(parseSitemap(xml)).toEqual({ kind: 'index', sitemaps: ['https://example.com/s1.xml'] })
  })

  it('sitemap の形でなければ invalid（HTML が返ってきたときなど）', () => {
    expect(parseSitemap('<html><body>Not found</body></html>')).toEqual({ kind: 'invalid' })
    expect(parseSitemap('')).toEqual({ kind: 'invalid' })
  })
})
