import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** API が返すエラーの形。フロントはこの code で分岐する */
export type ApiError = {
  error: {
    code: string
    message: string
    issues?: unknown
  }
}

export class AppError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(status, { message })
  }
}

export const errors = {
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'ログインが必要です'),
  noActiveOrganization: () =>
    new AppError(400, 'NO_ACTIVE_ORGANIZATION', '操作する組織が選ばれていません'),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'この組織のメンバーではありません'),
  // 他の組織のデータは「存在しない」と同じ扱いにする（存在するかどうかを漏らさない）
  notFound: (what: string) => new AppError(404, 'NOT_FOUND', `${what}が見つかりません`),
  runAlreadyActive: () =>
    new AppError(
      409,
      'RUN_ALREADY_ACTIVE',
      'このブランドはすでに実行中です。終わるまで待ってください',
    ),
  noPrompts: () => new AppError(400, 'NO_PROMPTS', '有効な質問が1つもありません'),
}

export function handleError(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json<ApiError>({ error: { code: err.code, message: err.message } }, err.status)
  }
  if (err instanceof HTTPException) {
    return c.json<ApiError>({ error: { code: 'HTTP_ERROR', message: err.message } }, err.status)
  }
  console.error(err)
  return c.json<ApiError>(
    { error: { code: 'INTERNAL_ERROR', message: 'サーバーでエラーが発生しました' } },
    500,
  )
}
