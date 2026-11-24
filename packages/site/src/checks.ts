import { AI_CRAWLERS, type AiCrawler } from './ai-crawlers'
import type { PageFacts } from './html'
import { isAllowedByRobotsState, isSiteBlockedFor, type RobotsState } from './robots'

/** ok = 問題なし、warning = 注意、critical = 要対応 */
export type CheckStatus = 'ok' | 'warning' | 'critical'

export const SITE_CHECK_KEYS = ['robots_txt', 'ai_crawlers', 'llms_txt', 'sitemap', 'faq'] as const
export const PAGE_CHECK_KEYS = [
  'fetch',
  'noindex',
  'title',
  'meta_description',
  'h1',
  'structured_data',
  'faq',
  'body_text',
  'brand_name',
  'canonical',
] as const
export type SiteCheckKey = (typeof SITE_CHECK_KEYS)[number]
export type PageCheckKey = (typeof PAGE_CHECK_KEYS)[number]

export type CheckResult<K extends string = string> = {
  key: K
  status: CheckStatus
  /** クライアント向けの説明（そのまま画面に出す） */
  message: string
  /** 説明の材料（ブロックしているクローラーの名前など） */
  detail?: Record<string, unknown>
}

/** 長さの目安（文字数）。検索結果や AI の引用で切られにくく、内容が伝わる長さ */
export const TITLE_LENGTH = { min: 10, max: 60 }
export const DESCRIPTION_LENGTH = { min: 50, max: 160 }
/** 本文がこれより少ないと、AI が内容をつかみにくい */
export const MIN_BODY_TEXT_LENGTH = 300

const ok = <K extends string>(key: K, message: string, detail?: Record<string, unknown>) => ({
  key,
  status: 'ok' as const,
  message,
  ...(detail ? { detail } : {}),
})
const warning = <K extends string>(key: K, message: string, detail?: Record<string, unknown>) => ({
  key,
  status: 'warning' as const,
  message,
  ...(detail ? { detail } : {}),
})
const critical = <K extends string>(key: K, message: string, detail?: Record<string, unknown>) => ({
  key,
  status: 'critical' as const,
  message,
  ...(detail ? { detail } : {}),
})

// ---------------------------------------------------------------------------
// サイト全体
// ---------------------------------------------------------------------------

export type SiteInput = {
  /** トップページ（https://example.com） */
  origin: string
  robots: RobotsState
  /** llms.txt が置かれているか */
  hasLlmsTxt: boolean
  /** sitemap が見つかったか（robots.txt の Sitemap: か /sitemap.xml） */
  hasSitemap: boolean
  /** 診断で選んだページの URL（クローラーが一部のページだけ止められていないかを見る） */
  pageUrls: string[]
  /** 読めたページのどこかに、よくある質問があるか */
  hasFaqSomewhere: boolean
}

export function checkSite(input: SiteInput): CheckResult<SiteCheckKey>[] {
  return [
    checkRobotsTxt(input.robots),
    checkAiCrawlers(input),
    input.hasLlmsTxt
      ? ok('llms_txt', 'llms.txt が置かれています。AI にサイトの要点を伝えられます。')
      : warning(
          'llms_txt',
          'llms.txt がありません。サイトの概要と主なページを AI 向けにまとめた llms.txt を置くと、AI がサイトの内容をつかみやすくなります（対応している AI はまだ一部です）。',
        ),
    input.hasSitemap
      ? ok('sitemap', 'サイトマップ（sitemap.xml）があります。')
      : warning(
          'sitemap',
          'サイトマップ（sitemap.xml）が見つかりません。サイトマップがあると、AI や検索エンジンのクローラーが全部のページを見つけやすくなります。robots.txt に Sitemap: の行を書いておくとさらに確実です。',
        ),
    input.hasFaqSomewhere
      ? ok('faq', 'よくある質問（Q&A の形）のページがあります。')
      : warning(
          'faq',
          '診断したページに、よくある質問（Q&A の形）が見つかりませんでした。AI は質問に答える形で回答を作るので、お客様がよく聞く質問と答えをまとめたページがあると、回答に使われやすくなります。',
        ),
  ]
}

function checkRobotsTxt(robots: RobotsState): CheckResult<SiteCheckKey> {
  if (robots.kind === 'found') return ok('robots_txt', 'robots.txt を読めました。')
  if (robots.kind === 'missing') {
    return ok('robots_txt', 'robots.txt はありません。すべてのクローラーがサイトを読める状態です。')
  }
  return critical(
    'robots_txt',
    'robots.txt を読めませんでした（サーバーのエラーなど）。robots.txt が読めないと、AI のクローラーはサイト全体を読まないことがあります。サーバーの設定を確かめてください。',
    { reason: robots.reason },
  )
}

function checkAiCrawlers(input: SiteInput): CheckResult<SiteCheckKey> {
  const blocked: AiCrawler[] = []
  const partial: AiCrawler[] = []
  for (const crawler of AI_CRAWLERS) {
    if (isSiteBlockedFor(input.robots, crawler.userAgent, input.origin)) blocked.push(crawler)
    else if (input.pageUrls.some((url) => isTargetedAt(input.robots, crawler.userAgent, url)))
      partial.push(crawler)
  }
  const names = (list: AiCrawler[]) => list.map((c) => c.userAgent)
  const detail = { blocked: names(blocked), partiallyBlocked: names(partial) }
  const answering = blocked.filter((c) => c.purpose !== 'training')
  if (answering.length > 0) {
    return critical(
      'ai_crawlers',
      `robots.txt で、AI の検索や回答に使われるクローラー（${names(answering).join('、')}）を止めています。止めている AI の回答には、御社のサイトが出にくくなります。意図したものでなければ、robots.txt から外してください。`,
      detail,
    )
  }
  if (blocked.length > 0 || partial.length > 0) {
    const parts = [
      blocked.length > 0 ? `学習用のクローラー（${names(blocked).join('、')}）をサイト全体で` : '',
      partial.length > 0 ? `${names(partial).join('、')} を一部のページで` : '',
    ].filter(Boolean)
    return warning(
      'ai_crawlers',
      `robots.txt で、${parts.join('、')}止めています。AI の検索への影響は小さいですが、方針どおりかを確かめてください。`,
      detail,
    )
  }
  return ok('ai_crawlers', 'AI のクローラーを robots.txt で止めていません。', detail)
}

/**
 * そのクローラーだけを狙って止めているページか。どのクローラーにも止めているページ（管理画面など）は数えない
 * （ふつうのクローラーの名前で比べる。名前のないクローラーは * のグループが当てはまる）
 */
const GENERIC_CRAWLER = 'llmo-tracker-generic-crawler'
function isTargetedAt(robots: RobotsState, userAgent: string, url: string): boolean {
  return (
    !isAllowedByRobotsState(robots, userAgent, url) &&
    isAllowedByRobotsState(robots, GENERIC_CRAWLER, url)
  )
}

// ---------------------------------------------------------------------------
// ページごと
// ---------------------------------------------------------------------------

export type PageInput = {
  url: string
  facts: PageFacts
  /** 本文に出ているかを確かめる名前（会社名・サービス名と別の呼び方）。空なら確かめない */
  names: string[]
}

export function checkPage(input: PageInput): CheckResult<PageCheckKey>[] {
  const { facts } = input
  return [
    facts.noindex
      ? critical(
          'noindex',
          'noindex が付いていて、検索エンジンに載らない設定です。AI の検索も検索エンジンの情報を使うので、載せたいページなら noindex を外してください。',
        )
      : ok('noindex', '検索エンジンに載る設定です（noindex なし）。'),
    checkTitle(facts.title),
    checkDescription(facts.metaDescription),
    checkH1(facts.h1),
    checkStructuredData(facts),
    ...(facts.faq
      ? [ok('faq', 'よくある質問（Q&A の形）があります。', { source: facts.faq })]
      : []),
    facts.textLength < MIN_BODY_TEXT_LENGTH
      ? warning(
          'body_text',
          `本文が ${facts.textLength} 文字と少なめです。AI は本文から答えを探すので、${MIN_BODY_TEXT_LENGTH} 文字以上を目安に、サービスの特徴や料金、よくある質問への答えを文章で書いてください。`,
          { length: facts.textLength },
        )
      : ok('body_text', `本文は ${facts.textLength} 文字です。`, { length: facts.textLength }),
    ...checkBrandName(input),
    checkCanonical(input.url, facts.canonical),
  ]
}

function checkTitle(title: string | null): CheckResult<PageCheckKey> {
  if (!title) {
    return critical(
      'title',
      'ページのタイトル（title）がありません。AI や検索エンジンは、タイトルでページの内容を判断します。',
    )
  }
  const length = [...title].length
  if (length < TITLE_LENGTH.min || length > TITLE_LENGTH.max) {
    return warning(
      'title',
      `タイトルが ${length} 文字です。${TITLE_LENGTH.min}〜${TITLE_LENGTH.max} 文字くらいで、会社名・サービス名と、何のページかが分かる言葉を入れてください。`,
      { length, title },
    )
  }
  return ok('title', `タイトルは ${length} 文字です。`, { length, title })
}

function checkDescription(description: string | null): CheckResult<PageCheckKey> {
  if (!description) {
    return warning(
      'meta_description',
      'ページの説明（meta description）がありません。ページの要約を書いておくと、AI や検索エンジンが内容をつかみやすくなります。',
    )
  }
  const length = [...description].length
  if (length < DESCRIPTION_LENGTH.min || length > DESCRIPTION_LENGTH.max) {
    return warning(
      'meta_description',
      `ページの説明が ${length} 文字です。${DESCRIPTION_LENGTH.min}〜${DESCRIPTION_LENGTH.max} 文字くらいで、ページの要点をまとめてください。`,
      { length },
    )
  }
  return ok('meta_description', `ページの説明は ${length} 文字です。`, { length })
}

function checkH1(h1: string[]): CheckResult<PageCheckKey> {
  if (h1.length === 0) {
    return warning(
      'h1',
      '一番大きな見出し（h1）がありません。ページの主題を h1 で 1 つ示すと、AI が内容をつかみやすくなります。',
    )
  }
  if (h1.length > 1) {
    return warning(
      'h1',
      `一番大きな見出し（h1）が ${h1.length} つあります。ページの主題が伝わるよう、h1 は 1 つにしてください。`,
      { h1 },
    )
  }
  return ok('h1', '一番大きな見出し（h1）が 1 つあります。', { h1 })
}

function checkStructuredData(facts: PageFacts): CheckResult<PageCheckKey> {
  const detail = { types: facts.jsonLdTypes, broken: facts.brokenJsonLd }
  if (facts.brokenJsonLd > 0) {
    return critical(
      'structured_data',
      `構造化データ（JSON-LD）のうち ${facts.brokenJsonLd} つが、書き方の誤りで読めません。読めない構造化データは AI にも検索エンジンにも使われないので、書き方を直してください。`,
      detail,
    )
  }
  if (facts.jsonLdTypes.length === 0) {
    return warning(
      'structured_data',
      '構造化データ（JSON-LD）がありません。会社（Organization）、商品（Product）、よくある質問（FAQPage）などを構造化データで書くと、AI が情報を正確に読み取りやすくなります。',
      detail,
    )
  }
  return ok('structured_data', `構造化データ：${facts.jsonLdTypes.join('、')}`, detail)
}

function checkBrandName(input: PageInput): CheckResult<PageCheckKey>[] {
  if (input.names.length === 0) return []
  const found = input.facts.mentionedNames
  if (found.length === 0) {
    return [
      warning(
        'brand_name',
        `本文に会社名・サービス名（${input.names.join('、')}）が出てきません。AI はページの文章から名前を拾うので、画像やロゴだけでなく、文章でも名前を書いてください。`,
        { names: input.names, found },
      ),
    ]
  }
  return [
    ok('brand_name', `本文に「${found.join('」「')}」が出ています。`, {
      names: input.names,
      found,
    }),
  ]
}

function checkCanonical(url: string, canonical: string | null): CheckResult<PageCheckKey> {
  if (!canonical) {
    return warning(
      'canonical',
      '正規の URL（canonical）が指定されていません。同じ内容のページが複数の URL で見られる場合に、どれを正とするかを指定しておくと評価が分散しません。',
    )
  }
  if (sameUrl(url, canonical))
    return ok('canonical', '正規の URL（canonical）はこのページ自身です。')
  return warning(
    'canonical',
    '正規の URL（canonical）が別のページを指しています。このページ自身は検索エンジンや AI に使われにくくなります。意図したものか確かめてください。',
    { canonical },
  )
}

/** 末尾の / や www. の違いは同じ URL とみなす */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    if (!URL.canParse(u)) return u
    const parsed = new URL(u)
    const host = parsed.hostname.replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/$/, '')
    return `${host}${path}${parsed.search}`
  }
  return norm(a) === norm(b)
}

/** HTTP のエラーや読めなかったときの項目 */
export function fetchFailure(message: string, detail?: Record<string, unknown>) {
  return critical<PageCheckKey>('fetch', message, detail)
}

/** HTTP のステータスごとの説明 */
export function httpStatusMessage(status: number): string {
  if (status === 404 || status === 410) {
    return `ページが見つかりません（${status}）。AI の回答で引用されたページやサイトマップに載っているページなら、ページを戻すか、新しいページへリダイレクトしてください。`
  }
  if (status === 401 || status === 403) {
    return `ページを読む権限がありません（${status}）。AI のクローラーも読めない可能性があります。`
  }
  if (status >= 500) return `サーバーのエラーで読めませんでした（${status}）。`
  return `ページを読めませんでした（${status}）。`
}
