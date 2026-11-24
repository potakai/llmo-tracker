import { describe, expect, it } from 'vitest'
import { extractPageFacts } from '../src/html'

const URL_ = 'https://maru.example.com/features'
const facts = (html: string, names: string[] = []) => extractPageFacts(html, { url: URL_, names })

describe('HTML から診断の材料を取り出す', () => {
  it('title・meta description・h1・canonical・リンクを取り出す', () => {
    const result = facts(`<!doctype html><html><head>
      <title>  機能一覧 ｜ ◯◯会計 </title>
      <meta name="Description" content="◯◯会計の機能を紹介します">
      <link rel="alternate canonical" href="/features/">
      </head><body>
      <h1>機能<span>一覧</span></h1>
      <a href="/pricing#plans">料金</a><a href="mailto:a@example.com">メール</a><a href="https://other.example/">外</a>
      </body></html>`)
    expect(result).toMatchObject({
      title: '機能一覧 ｜ ◯◯会計',
      metaDescription: '◯◯会計の機能を紹介します',
      h1: ['機能一覧'],
      canonical: 'https://maru.example.com/features/',
      noindex: false,
    })
    expect(result.links).toEqual(['https://maru.example.com/pricing', 'https://other.example/'])
  })

  it('h1 が複数あれば全部を取り出し、なければ空にする', () => {
    expect(facts('<h1>A</h1><h1>B</h1>').h1).toEqual(['A', 'B'])
    expect(facts('<h2>A</h2>').h1).toEqual([])
  })

  it('JSON-LD の種類を、配列・@graph・@type の配列・schema.org の URL の形からも取り出す', () => {
    const result = facts(`
      <script type="application/ld+json">{"@type":"Organization","founder":{"@type":"Person"}}</script>
      <script type="application/ld+json">[{"@type":["Product","Thing"]}]</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"http://schema.org/Article"}]}</script>
      <script type="APPLICATION/LD+JSON"><!-- {"@type":"WebSite"} --></script>`)
    // 入れ子の Person は数えない（一番外側と @graph の中だけ）
    expect(result.jsonLdTypes).toEqual([
      'Article',
      'BreadcrumbList',
      'Organization',
      'Product',
      'Thing',
      'WebSite',
    ])
    expect(result.brokenJsonLd).toBe(0)
  })

  it('壊れた JSON-LD は数だけ数え、ほかの JSON-LD は取り出す', () => {
    const result = facts(`
      <script type="application/ld+json">{"@type": "Article",}</script>
      <script type="application/ld+json"></script>
      <script type="application/ld+json">{"@type":"FAQPage"}</script>`)
    expect(result.jsonLdTypes).toEqual(['FAQPage'])
    expect(result.brokenJsonLd).toBe(2)
    expect(result.faq).toBe('json-ld')
  })

  it('よくある質問を、JSON-LD・microdata・質問の形の見出しから見つける', () => {
    expect(facts('<div itemscope itemtype="https://schema.org/FAQPage"></div>').faq).toBe(
      'microdata',
    )
    expect(
      facts(
        '<details><summary>無料で使えますか？</summary>はい</details><h3>Q. 解約できますか</h3>',
      ).faq,
    ).toBe('html')
    expect(facts('<dl><dt>料金は?</dt><dd>月 1,000 円</dd><dt>質問：対応OS</dt></dl>').faq).toBe(
      'html',
    )
    // 質問の形の見出しが 1 つだけなら、よくある質問とはみなさない
    expect(facts('<h2>クラウド会計とは？</h2><h2>特徴</h2>').faq).toBeNull()
  })

  it('本文の文字数は、空白と script・style・title を数えない', () => {
    const result = facts(
      '<head><title>タイトル</title><style>body{}</style></head><body><script>var a = 1</script><p>あい う\n え</p><noscript>JS</noscript></body>',
    )
    expect(result.textLength).toBe(4)
  })

  it('本文に名前が出ているかを、全角・半角や大文字・小文字の違いを無視して確かめる', () => {
    const result = facts('<p>ＭＡＲＵ会計 は便利です</p>', ['maru会計', 'マル会計', ''])
    expect(result.mentionedNames).toEqual(['maru会計'])
  })

  it('meta robots・googlebot・X-Robots-Tag の noindex を見つける', () => {
    expect(facts('<meta name="robots" content="index, follow">').noindex).toBe(false)
    expect(facts('<meta name="ROBOTS" content="NOINDEX,follow">').noindex).toBe(true)
    expect(facts('<meta name="googlebot" content="none">').noindex).toBe(true)
    expect(
      extractPageFacts('<p>x</p>', { url: URL_, xRobotsTag: 'noarchive, noindex' }).noindex,
    ).toBe(true)
  })

  it('閉じていないタグや </head> のない壊れた HTML でも、取れるものは取る', () => {
    const result = facts(
      '<html><head><title>壊れた<b>ページ</title><meta name=description content=説明><body><h1>見出し<p>本文がここにあります<div><span>',
    )
    expect(result.title).toBe('壊れた<b>ページ')
    expect(result.metaDescription).toBe('説明')
    expect(result.h1).toEqual(['見出し本文がここにあります'])
    expect(result.textLength).toBeGreaterThan(5)
  })

  it('空の HTML でも落ちない', () => {
    expect(facts('')).toMatchObject({ title: null, metaDescription: null, h1: [], textLength: 0 })
  })
})
