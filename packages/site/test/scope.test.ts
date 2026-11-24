import { describe, expect, it } from 'vitest'
import { isWithinDomain, toAuditableUrl } from '../src/scope'

describe('診断で読んでよい範囲', () => {
  it('保存してあるドメインそのものと、そのサブドメインだけ（保存値から www. を取らない）', () => {
    expect(isWithinDomain('www.maru.example.com', 'www.maru.example.com')).toBe(true)
    expect(isWithinDomain('blog.www.maru.example.com', 'www.maru.example.com')).toBe(true)
    expect(isWithinDomain('maru.example.com', 'www.maru.example.com')).toBe(false)
    expect(isWithinDomain('shop.maru.example.com', 'www.maru.example.com')).toBe(false)
    expect(isWithinDomain('WWW.Maru.Example.com.', 'www.maru.example.com')).toBe(true)
  })

  it('保存値が www. なしなら、www. 付きはサブドメインとして読む', () => {
    expect(isWithinDomain('www.maru.example.com', 'maru.example.com')).toBe(true)
    expect(isWithinDomain('badmaru.example.com', 'maru.example.com')).toBe(false)
  })

  it('URL の判定でも同じ範囲を使う', () => {
    expect(toAuditableUrl('https://maru.example.com/', 'www.maru.example.com')).toBeNull()
    expect(toAuditableUrl('https://www.maru.example.com/a', 'www.maru.example.com')?.href).toBe(
      'https://www.maru.example.com/a',
    )
  })
})
