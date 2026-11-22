import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { config, proxy } from '@/proxy'
import { CURRENT_BRAND_COOKIE } from '@/server/current-brand'

const BRAND_ID = '01938d1e-7b4a-7c3e-9f2d-5a6b7c8d9e0f'
const ORIGIN = 'http://localhost:3000'

const rememberedBy = (path: string) =>
  proxy(new NextRequest(`${ORIGIN}${path}`)).cookies.get(CURRENT_BRAND_COOKIE)

const matches = (url: string, headers?: Record<string, string>) =>
  unstable_doesMiddlewareMatch({ config, url, headers })

describe('proxy：開いたブランドを Cookie に覚える', () => {
  it('ブランドの画面を開くと、そのブランド ID を Cookie に書く（設定や実行の詳細でも）', () => {
    for (const path of [
      `/app/brands/${BRAND_ID}`,
      `/app/brands/${BRAND_ID}/settings`,
      `/app/brands/${BRAND_ID}/runs/${crypto.randomUUID()}`,
    ]) {
      const cookie = rememberedBy(path)
      expect(cookie?.value).toBe(BRAND_ID)
      expect(cookie).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax' })
    }
  })

  it('ブランドの追加（/app/brands/new）や、UUID でない ID では書かない', () => {
    expect(rememberedBy('/app/brands/new')).toBeUndefined()
    expect(rememberedBy('/app/brands/not-a-uuid')).toBeUndefined()
  })

  it('ブランドの画面でだけ動き、先読み（prefetch）では動かない', () => {
    expect(matches(`/app/brands/${BRAND_ID}`)).toBe(true)
    expect(matches(`/app/brands/${BRAND_ID}/settings`)).toBe(true)
    expect(matches('/app')).toBe(false)
    expect(matches('/api/brands')).toBe(false)
    // メニューのリンクの先読みで、開いていないブランドを覚えないように
    expect(matches(`/app/brands/${BRAND_ID}`, { 'next-router-prefetch': '1' })).toBe(false)
    expect(matches(`/app/brands/${BRAND_ID}`, { purpose: 'prefetch' })).toBe(false)
  })
})
