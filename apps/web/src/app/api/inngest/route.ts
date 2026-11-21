import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { functions } from '@/inngest/functions'

/**
 * Inngest が関数を呼びに来る入口。Hono の /api/[[...route]] より、こちらの固定のパスが優先される。
 *
 * 上限は Vercel の最大（300 秒）にする。execute-run の 1 回のリクエストは、ふつう最長で
 *   checkpoint の時間枠（CHECKPOINT_MAX_RUNTIME_MS = 10 秒。この間は次のステップを続けて始める）
 *   + 最後に始めた slice の予算（45 秒）
 *   + 予算を使い切ったときに投げ途中だった質問のタイムアウト（120 秒）
 *   ≒ 175 秒 + DB の読み書き
 * かかる。SDK は時間枠を過ぎたら新しいステップを始めないので、slice ごとに足し上がることはない。
 * DB の読み書きには期限がないので、DB が長く待たされると超えうる（ほかの API と同じリスクとして受け入れる）
 */
export const maxDuration = 300

export const { GET, POST, PUT } = serve({ client: inngest, functions })
