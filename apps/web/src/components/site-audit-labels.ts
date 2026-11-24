/** 診断の項目の名前（packages/site の SITE_CHECK_KEYS / PAGE_CHECK_KEYS） */
export const SITE_CHECK_LABEL: Record<string, string> = {
  robots_txt: 'robots.txt',
  ai_crawlers: 'AI のクローラーを止めていないか',
  llms_txt: 'llms.txt',
  sitemap: 'サイトマップ',
  faq: 'よくある質問（Q&A）',
}

export const PAGE_CHECK_LABEL: Record<string, string> = {
  fetch: 'ページを読めたか',
  noindex: '検索エンジンに載る設定か（noindex）',
  title: 'タイトル（title）',
  meta_description: 'ページの説明（meta description）',
  h1: '一番大きな見出し（h1）',
  structured_data: '構造化データ（JSON-LD）',
  faq: 'よくある質問（Q&A）',
  body_text: '本文の量',
  brand_name: '本文に会社名・サービス名があるか',
  canonical: '正規の URL（canonical）',
}

export const CHECK_STATUS_LABEL = { ok: '問題なし', warning: '注意', critical: '要対応' } as const

export const PAGE_SOURCE_LABEL = {
  top: 'トップページ',
  cited: 'AI の回答で引用',
  sitemap: 'サイトマップ',
  link: 'トップページのリンク',
} as const

export const PAGE_STATUS_LABEL = {
  pending: '読む前',
  fetched: '診断済み',
  failed: '読めなかった',
  skipped: '読んでいない',
} as const

export const SITE_AUDIT_STATUS_LABEL = {
  queued: '待機中',
  running: '診断中',
  succeeded: '完了',
  failed: '失敗',
} as const

/** URL を、画面で読みやすい形にする（https:// とドメインを省いた path。トップは「/」） */
export function pathOf(url: string): string {
  if (!URL.canParse(url)) return url
  const parsed = new URL(url)
  try {
    return `${decodeURI(parsed.pathname)}${parsed.search}`
  } catch {
    return `${parsed.pathname}${parsed.search}`
  }
}
