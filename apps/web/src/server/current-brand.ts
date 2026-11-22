import type { Context } from 'hono'
import { setCookie } from 'hono/cookie'

/**
 * 最後に見たブランドの ID を覚えておく Cookie。/app に来たら、このブランドの画面へ移動する。
 * 中身はブランド ID だけで、読むときは必ず自分の組織のブランドかを確かめる（resolveHomeBrandId）
 */
export const CURRENT_BRAND_COOKIE = 'llmo_current_brand'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/** 今のブランドを覚える。組織のブランドかどうかは、呼ぶ前に確かめておく */
export function rememberBrand(c: Context, brandId: string) {
  setCookie(c, CURRENT_BRAND_COOKIE, brandId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ONE_YEAR_SECONDS,
  })
}
