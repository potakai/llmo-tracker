import { hc } from 'hono/client'
import type { AppType } from '@/server/app'

/**
 * 型付きの API クライアント。
 * サーバー側のルートや Zod スキーマを変えると、呼び出し側で型エラーになる。
 *   const res = await api.brands.$post({ json: { name: '◯◯会計', prompts: ['...'] } })
 */
export const api = hc<AppType>('/').api
