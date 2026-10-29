import { describe, expect, it } from 'vitest'
import { toCitations } from '../src'

describe('toCitations', () => {
  it('同じ URL は1つにまとめ、www を外したドメインで自社サイトかを判定する', () => {
    const rows = toCitations(
      [
        { url: 'https://www.maru.example.com/price', title: '料金' },
        { url: 'https://blog.maru.example.com/a' },
        { url: 'https://www.maru.example.com/price' },
        { url: 'https://other.example.org/x' },
        { url: 'not a url' },
      ],
      'maru.example.com',
    )
    expect(rows).toEqual([
      {
        url: 'https://www.maru.example.com/price',
        domain: 'maru.example.com',
        title: '料金',
        position: 0,
        isOwnDomain: true,
      },
      {
        url: 'https://blog.maru.example.com/a',
        domain: 'blog.maru.example.com',
        title: null,
        position: 1,
        isOwnDomain: true,
      },
      {
        url: 'https://other.example.org/x',
        domain: 'other.example.org',
        title: null,
        position: 2,
        isOwnDomain: false,
      },
    ])
  })

  it('自社ドメインが未登録なら、すべて自社ではない', () => {
    const rows = toCitations([{ url: 'https://maru.example.com/' }], null)
    expect(rows[0]?.isOwnDomain).toBe(false)
  })
})
