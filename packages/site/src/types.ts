/** live = 本物のサイトを読む、fake = 読まない（動作確認用の作り物の HTML を返す） */
export type SiteMode = 'live' | 'fake'

/** 読んだ結果。2xx 以外は本文を読まない（body は空） */
export type FetchedResource = {
  /** リダイレクトのあとの URL */
  url: string
  status: number
  contentType: string | null
  /** X-Robots-Tag ヘッダー（noindex の判定に使う） */
  xRobotsTag: string | null
  body: string
}

export type FetchOptions = {
  signal?: AbortSignal
}

/** サイトを読むもの。本物とフェイクはこの形にそろえる。読める範囲は作るときに渡したドメインだけ */
export interface SiteFetcher {
  readonly mode: SiteMode
  fetch(url: string, options?: FetchOptions): Promise<FetchedResource>
}

/**
 * 読まなかった・読めなかった理由。
 * - outside_site：登録したドメインの外（リダイレクトで外に出た場合も）
 * - blocked_address：名前解決した IP が、プライベート・ループバック・メタデータなどのアドレス
 */
export type SiteFetchErrorReason =
  | 'invalid_url'
  | 'outside_site'
  | 'blocked_address'
  | 'dns'
  | 'too_many_redirects'
  | 'timeout'
  | 'too_large'
  | 'unsupported_type'
  | 'network'

const REASON_MESSAGES: Record<SiteFetchErrorReason, string> = {
  invalid_url: 'URL の形が正しくないため、読みませんでした',
  outside_site: '登録したドメインの外のページなので、読みませんでした',
  blocked_address:
    '公開されていないアドレス（社内のネットワークなど）を指していたので、読みませんでした',
  dns: 'ドメインの名前解決ができませんでした',
  too_many_redirects: 'リダイレクトが多すぎるため、読むのをやめました',
  timeout: '時間内に読み込めませんでした',
  too_large: 'ページが大きすぎるため、読むのをやめました',
  unsupported_type: 'HTML やテキストではないため、読みませんでした',
  network: '通信のエラーで読めませんでした',
}

export class SiteFetchError extends Error {
  constructor(
    readonly reason: SiteFetchErrorReason,
    /** 調べるためのくわしい情報（ログ用。画面には reason の文言を出す） */
    readonly detail?: string,
  ) {
    super(REASON_MESSAGES[reason])
    this.name = 'SiteFetchError'
  }
}
