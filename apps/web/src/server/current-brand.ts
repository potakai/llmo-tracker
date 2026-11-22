/**
 * 最後に見たブランドの ID を覚えておく Cookie。ブランドの画面を開くと proxy.ts が書き、
 * /app に来たらこのブランドの画面へ移動する。中身はブランド ID だけで、書くときは組織を確かめない。
 * 読むときに必ず自分の組織のブランドかを確かめる（resolveHomeBrandId）
 */
export const CURRENT_BRAND_COOKIE = 'llmo_current_brand'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export const CURRENT_BRAND_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: ONE_YEAR_SECONDS,
} as const
