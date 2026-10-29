import { sValidator } from '@hono/standard-validator'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ValidationTargets } from 'hono'
import type { ApiError } from './errors'

/**
 * Zod などのスキーマでリクエストを検証する。
 * 失敗したら ApiError の形で 400 を返す（エラーの形をアプリ全体でそろえる）。
 */
export const validate = <T extends keyof ValidationTargets, S extends StandardSchemaV1>(
  target: T,
  schema: S,
) =>
  sValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json<ApiError>(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: '入力内容に誤りがあります',
            issues: result.error.map((issue) => ({
              path: issue.path?.map((p) => (typeof p === 'object' ? p.key : p)),
              message: issue.message,
            })),
          },
        },
        400,
      )
    }
  })
