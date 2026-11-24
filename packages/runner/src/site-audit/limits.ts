/** 1 回の診断で読むページの数の上限 */
export const MAX_AUDIT_PAGES = 50
/** 読む sitemap のファイルの数の上限（sitemapindex の先を含む） */
export const MAX_SITEMAP_FILES = 5
/** AI の回答で引用されたページを、直近何日分から拾うか */
export const CITED_LOOKBACK_DAYS = 90
/**
 * 本物のサイトを読むときの礼儀。同時に読むのは 2 ページまで、読み終えてから次を読むまで 1 秒あける
 * （相手のサーバーに負担をかけない）。フェイクのサイトでは待たない
 */
export const LIVE_PAGE_CONCURRENCY = 2
export const LIVE_REQUEST_INTERVAL_MS = 1_000
/** フェイクのサイトは外に出ないので、まとめて読む */
export const FAKE_PAGE_CONCURRENCY = 8
/**
 * 止まったとみなすまでの時間。50 ページを 2 ページずつ、1 秒あけて読む（1 ページ最長 10 秒）と最長でも 5 分ほど。
 * Inngest のリトライで遅れても、これだけあれば自分で終わる
 */
export const DEFAULT_SITE_AUDIT_STALE_AFTER_MINUTES = 120
