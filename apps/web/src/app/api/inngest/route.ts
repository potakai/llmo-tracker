import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { functions } from '@/inngest/functions'

/**
 * Inngest が関数を呼びに来る入口。Hono の /api/[[...route]] より、こちらの固定のパスが優先される。
 * execute-run の 1 ステップ（予算 45 秒 + 投げ途中の質問の待ち）が収まるよう、上限を Vercel の最大にする
 */
export const maxDuration = 300

export const { GET, POST, PUT } = serve({ client: inngest, functions })
