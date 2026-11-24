import { toAuditableUrl } from './scope'
import { type FetchedResource, SiteFetchError, type SiteFetcher } from './types'

export type FakeSiteOptions = {
  registeredDomain: string
  /** 本文に入れる会社名・サービス名 */
  brandName: string
  /**
   * サイトの版。0 は少し前のサイト（PerplexityBot を止めている・機能のページに説明がない）、
   * 1 は今のサイト（それが直り、ブログの構造化データが壊れた）。前回からの変化をデモで見せるため
   */
  revision?: 0 | 1
}

type FakePage = {
  title: string | null
  description?: string
  h1: string[]
  jsonLd?: string[]
  body: string
  canonical?: string | null
  noindex?: boolean
  faq?: [string, string][]
}

const HTML = 'text/html; charset=utf-8'
const TEXT = 'text/plain; charset=utf-8'
const XML = 'application/xml'

/** 長めの本文（300 文字を超えるように同じ段落を重ねる） */
const paragraph = (name: string, topic: string) =>
  `${name}の${topic}についてご紹介します。${PARAGRAPH}${PARAGRAPH}`
const PARAGRAPH = `中小企業や個人事業主の方が、経理の経験がなくても毎日の記帳から決算まで進められるよう、画面の分かりやすさと自動化にこだわっています。銀行口座やクレジットカードの明細を自動で取り込み、勘定科目を提案するので、入力の手間が大きく減ります。インボイス制度や電子帳簿保存法にも対応しています。`

/**
 * フェイクのサイト。本物のサイトは読まず、登録したドメインの作り物のページを返す（開発・テスト・CI・デモ用）。
 * 本物と同じく、登録したドメインの外は読まない
 */
export function createFakeSiteFetcher(options: FakeSiteOptions): SiteFetcher {
  const revision = options.revision ?? 1
  const origin = `https://${options.registeredDomain}`
  const pages = fakePages(options.brandName, origin, revision)

  return {
    mode: 'fake',
    async fetch(rawUrl: string): Promise<FetchedResource> {
      if (!URL.canParse(rawUrl)) throw new SiteFetchError('invalid_url', rawUrl)
      const url = toAuditableUrl(rawUrl, options.registeredDomain)
      if (!url) throw new SiteFetchError('outside_site', rawUrl)
      const respond = (status: number, contentType: string | null, body: string) => ({
        url: url.href,
        status,
        contentType,
        xRobotsTag: null,
        body: status === 200 ? body : '',
      })
      const path = url.pathname.replace(/\/$/, '') || '/'
      if (path === '/robots.txt') return respond(200, TEXT, fakeRobots(origin, revision))
      if (path === '/sitemap.xml') return respond(200, XML, fakeSitemap(origin, Object.keys(pages)))
      const page = pages[path]
      if (!page) return respond(404, HTML, '')
      return respond(200, HTML, renderPage(page))
    },
  }
}

function fakeRobots(origin: string, revision: 0 | 1): string {
  return [
    'User-agent: *',
    'Disallow: /admin/',
    '',
    'User-agent: GPTBot',
    'User-agent: CCBot',
    'Disallow: /',
    ...(revision === 0 ? ['', 'User-agent: PerplexityBot', 'Disallow: /'] : []),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
  ].join('\n')
}

function fakeSitemap(origin: string, paths: string[]): string {
  const all = [...paths, '/admin/login', '/old-campaign']
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...all.map((p) => `  <url><loc>${origin}${p === '/' ? '/' : p}</loc></url>`),
    '</urlset>',
  ].join('\n')
}

function fakePages(name: string, origin: string, revision: 0 | 1): Record<string, FakePage> {
  const org = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name })
  const description = (what: string) =>
    `${name}の${what}をご紹介します。中小企業・個人事業主向けのクラウド会計ソフトで、記帳から決算・確定申告までをかんたんに進められます。`
  return {
    '/': {
      title: `${name}｜中小企業向けクラウド会計ソフト`,
      description: description('サービス概要'),
      h1: [`${name}で、経理をもっとかんたんに`],
      jsonLd: [
        org,
        JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name, url: origin }),
      ],
      body: paragraph(name, 'サービス'),
      canonical: `${origin}/`,
    },
    '/features': {
      title: `機能一覧｜${name}`,
      ...(revision === 1 ? { description: description('機能') } : {}),
      h1: ['機能一覧'],
      jsonLd: [
        JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, brand: name }),
      ],
      body: paragraph(name, '機能'),
      canonical: `${origin}/features`,
    },
    '/pricing': {
      title: `料金プラン｜${name}`,
      description: description('料金プラン'),
      h1: ['料金プラン', '無料で試す'],
      body: paragraph(name, '料金プラン'),
      canonical: `${origin}/pricing`,
    },
    '/faq': {
      title: `よくある質問｜${name}`,
      description: description('よくある質問'),
      h1: ['よくある質問'],
      jsonLd: [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [{ '@type': 'Question', name: '無料で試せますか？' }],
        }),
      ],
      faq: [
        ['無料で試せますか？', '30 日間、すべての機能を無料でお試しいただけます。'],
        ['インボイス制度に対応していますか？', 'はい、適格請求書の発行と保存に対応しています。'],
      ],
      body: paragraph(name, 'よくある質問'),
      canonical: `${origin}/faq`,
    },
    '/company': {
      title: '会社概要',
      description: description('運営会社'),
      h1: ['会社概要'],
      jsonLd: [org],
      body: paragraph(name, '運営会社'),
      canonical: `${origin}/company`,
    },
    '/blog/invoice': {
      title: `インボイス制度の基本と会計ソフトの選び方｜${name}`,
      description: description('インボイス制度の解説'),
      h1: ['インボイス制度の基本と会計ソフトの選び方'],
      jsonLd: [
        revision === 1
          ? '{"@context": "https://schema.org", "@type": "Article", "headline": "インボイス制度の基本",}'
          : JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article' }),
      ],
      body: paragraph(name, 'インボイス制度への対応'),
      canonical: `${origin}/blog/invoice`,
    },
    '/blog/cloud': {
      title: `クラウド会計とは？｜${name}`,
      description: description('クラウド会計の解説'),
      h1: ['クラウド会計とは？'],
      body: paragraph(name, 'クラウド会計'),
      canonical: `${origin}/blog/invoice`,
      noindex: true,
    },
    '/contact': {
      title: 'お問い合わせ',
      h1: ['お問い合わせ'],
      body: 'フォームに入力して送信してください。担当者からご連絡します。',
      canonical: null,
    },
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function renderPage(page: FakePage): string {
  const head = [
    '<meta charset="utf-8">',
    page.title === null ? '' : `<title>${escapeHtml(page.title)}</title>`,
    page.description ? `<meta name="description" content="${escapeHtml(page.description)}">` : '',
    page.noindex ? '<meta name="robots" content="noindex, follow">' : '',
    page.canonical ? `<link rel="canonical" href="${escapeHtml(page.canonical)}">` : '',
    ...(page.jsonLd ?? []).map((json) => `<script type="application/ld+json">${json}</script>`),
  ]
  const faq = (page.faq ?? [])
    .map(
      ([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`,
    )
    .join('')
  const nav = ['/', '/features', '/pricing', '/faq', '/company', '/contact']
    .map((href) => `<a href="${href}">${href}</a>`)
    .join(' ')
  return [
    '<!doctype html><html lang="ja"><head>',
    ...head,
    '</head><body>',
    `<nav>${nav}</nav>`,
    ...page.h1.map((h) => `<h1>${escapeHtml(h)}</h1>`),
    `<p>${escapeHtml(page.body)}</p>`,
    faq,
    '</body></html>',
  ].join('\n')
}
