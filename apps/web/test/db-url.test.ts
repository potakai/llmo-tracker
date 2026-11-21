import { normalizeDatabaseUrl } from '@llmo/db'
import { describe, expect, it } from 'vitest'

describe('normalizeDatabaseUrl', () => {
  it('Neon の接続文字列から channel_binding を取り除き、ほかの指定は残す', () => {
    const neon =
      'postgresql://user:pass@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
    const url = new URL(normalizeDatabaseUrl(neon))
    expect(url.searchParams.has('channel_binding')).toBe(false)
    expect(url.searchParams.get('sslmode')).toBe('require')
    expect(url.password).toBe('pass')
    expect(url.hostname).toBe('ep-x-pooler.ap-southeast-1.aws.neon.tech')
  })

  it('取り除くものがなければ、文字列をそのまま返す', () => {
    const local = 'postgres://llmo:llmo@localhost:5432/llmo'
    expect(normalizeDatabaseUrl(local)).toBe(local)
  })
})
