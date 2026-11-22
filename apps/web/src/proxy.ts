import { type NextRequest, NextResponse } from 'next/server'
import { CURRENT_BRAND_COOKIE, CURRENT_BRAND_COOKIE_OPTIONS } from './server/current-brand'

const BRAND_PATH =
  /^\/app\/brands\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i

/**
 * ブランドの画面を開いたら、そのブランドを「最後に見たブランド」として Cookie に覚える（/app でそこを開く）。
 * サーバーがリクエストごとに書くので、素早く切り替えても最後に開いたブランドが残る。
 * ここでは組織を確かめない（DB を読まない）。他の組織のブランド ID が入っていても、
 * /app を開くときの resolveHomeBrandId が組織の中にあるかを確かめて、なければ最初のブランドを開く
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next()
  const brandId = BRAND_PATH.exec(request.nextUrl.pathname)?.[1]
  if (brandId) {
    response.cookies.set(CURRENT_BRAND_COOKIE, brandId.toLowerCase(), CURRENT_BRAND_COOKIE_OPTIONS)
  }
  return response
}

export const config = {
  matcher: [
    {
      source: '/app/brands/:brandId/:rest*',
      // 先読み（prefetch）では書かない。メニューのリンクの先読みで、開いていないブランドを覚えないように
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
