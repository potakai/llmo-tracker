/**
 * DataForSEO の Google Organic SERP API（Standard queue：task_post → task_get/advanced）の定数。
 * - https://docs.dataforseo.com/v3/serp/google/organic/task_post/
 * - https://docs.dataforseo.com/v3/serp/google/organic/task_get/advanced/
 * - https://docs.dataforseo.com/v3/appendix/errors/
 */

export const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com'
export const TASK_POST_PATH = '/v3/serp/google/organic/task_post'
export const TASK_GET_ADVANCED_PATH = '/v3/serp/google/organic/task_get/advanced'

/**
 * 地域：日本。公式の locations の一覧（Google 用）で確かめた値
 * （https://cdn.dataforseo.com/v3/locations/locations_serp_google_2026_11_02.csv の
 * `2392,Japan,,JP,Country`。一覧へのリンクは https://docs.dataforseo.com/v3/serp/google/locations/ にある）
 */
export const JAPAN_LOCATION_CODE = 2392

/**
 * 言語：日本語。公式の languages の一覧（Google 用）で確かめた値
 * （https://cdn.dataforseo.com/v3/languages/languages_serp_google_2026_04_06.csv の
 * `Japanese,ja`。一覧へのリンクは https://docs.dataforseo.com/v3/serp/google/languages/ にある）
 */
export const JAPANESE_LANGUAGE_CODE = 'ja'

/** 1 SERP = 上位 10 件。これより深く取ると 10 件ごとに費用が増える */
export const SERP_DEPTH = 10

/** ステータスコード（https://docs.dataforseo.com/v3/appendix/errors/） */
export const STATUS = {
  OK: 20000,
  TASK_CREATED: 20100,
  /** 検索結果が 0 件（検索自体は終わっている） */
  NO_SEARCH_RESULTS: 40102,
  /** 受け付けたが、まだ処理の列に入っていない */
  TASK_HANDED: 40601,
  /** 処理の列に入っている（まだ終わっていない） */
  TASK_IN_QUEUE: 40602,
} as const

/** まだ結果が出ていないことを表すコード */
export const PENDING_STATUS_CODES: ReadonlySet<number> = new Set([
  STATUS.TASK_HANDED,
  STATUS.TASK_IN_QUEUE,
])
