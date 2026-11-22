/** live = 本物の DataForSEO（費用がかかる）、fake = フェイク（費用ゼロ。動作確認用の作り物の検索結果） */
export type SerpMode = 'live' | 'fake'

/** Google の通常の検索結果（自然検索）の 1 件 */
export type OrganicResult = {
  /** 自然検索の中での順位（1 始まり。DataForSEO の rank_group） */
  rank: number
  /** 広告や AI による概要なども含めた、ページ全体での順位（rank_absolute） */
  rankAbsolute: number
  domain: string
  url: string
  title: string | null
}

export type AiOverviewReference = {
  url: string
  title: string | null
}

/** Google の「AI による概要（AI Overview）」 */
export type AiOverview = {
  /** あとから読み込まれる AI による概要だったか（asynchronous_ai_overview） */
  asynchronous: boolean
  /** 本文（markdown。なければ各要素の本文をつなげたもの） */
  text: string
  /** 引用元（URL の重複は除く。順番どおり） */
  references: AiOverviewReference[]
}

/** 検索結果のうち、このアプリで使う部分 */
export type ParsedSerp = {
  organic: OrganicResult[]
  /** AI による概要が出なければ null */
  aiOverview: AiOverview | null
}

/** フェイク用のヒント。本物のプロバイダーは使わない。フェイクはこの名前とドメインを混ぜて、それっぽい結果を作る */
export type SerpFakeHints = {
  brand: { name: string; domain: string | null }
  competitors: { name: string; domain: string | null }[]
}

export type PostTaskInput = {
  keyword: string
  /** DataForSEO にそのまま渡して、結果にも返ってくる目印（このアプリでは serp_result の ID） */
  tag?: string
  abortSignal?: AbortSignal
}

export type PostedTask = {
  /** 結果を取りに行くときに使う ID */
  taskId: string
  /** API が返した費用（USD）。返らなければ null */
  costUsd: number | null
}

export type FetchTaskInput = {
  taskId: string
  keyword: string
  abortSignal?: AbortSignal
  fakeHints?: SerpFakeHints
}

export type FetchedTask =
  /** まだ検索が終わっていない（あとでもう一度取りに行く） */
  | { status: 'pending' }
  | {
      status: 'ready'
      serp: ParsedSerp
      /** API が返したタスクの結果そのまま（あとで検証できるように保存する） */
      raw: unknown
    }

/** DataForSEO の呼び出し。本物とフェイクはこの形にそろえる */
export interface SerpProvider {
  readonly mode: SerpMode
  /** 検索を頼む（task_post）。費用はここでかかる */
  postTask(input: PostTaskInput): Promise<PostedTask>
  /** 頼んだ検索の結果を取りに行く（task_get）。取得は無料 */
  fetchTask(input: FetchTaskInput): Promise<FetchedTask>
}

/**
 * どこで失敗したか。
 * - request：呼び出し全体の失敗（HTTP のエラー、応答の形の違い、認証・残高・DataForSEO 側の障害など）。
 *   タスクは無事なことがあるので、結果の取得なら取り直す
 * - task：そのタスク自体のエラー（タスクが作れない・見つからない など）。取り直しても同じ
 */
export type SerpErrorScope = 'request' | 'task'

/** DataForSEO の呼び出しに失敗した */
export class SerpApiError extends Error {
  constructor(
    message: string,
    /** DataForSEO のステータスコード。HTTP のエラーや応答の形の違いでは null */
    readonly statusCode: number | null,
    readonly scope: SerpErrorScope,
  ) {
    super(message)
    this.name = 'SerpApiError'
  }
}
