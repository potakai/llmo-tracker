import { describe, expect, it } from 'vitest'
import { addDays, todayInTokyo, wilsonInterval } from '@/lib/stats'

describe('wilsonInterval', () => {
  it('回答が 0 件なら null', () => {
    expect(wilsonInterval(0, 0)).toEqual({ rate: null, low: null, high: null })
  })

  it('割合と、その前後の幅を返す（値は既知の計算結果と一致）', () => {
    const { rate, low, high } = wilsonInterval(4, 10)
    expect(rate).toBe(0.4)
    expect(low).toBeCloseTo(0.1682, 3)
    expect(high).toBeCloseTo(0.6873, 3)
  })

  it('0% や 100% でも 0〜1 の範囲からはみ出さない', () => {
    const zero = wilsonInterval(0, 5)
    const all = wilsonInterval(5, 5)
    expect(zero.low).toBe(0)
    expect(zero.high).toBeGreaterThan(0)
    expect(all.high).toBe(1)
    expect(all.low).toBeLessThan(1)
  })

  it('回答が多いほど幅が狭くなる', () => {
    const small = wilsonInterval(2, 5)
    const large = wilsonInterval(14, 35)
    expect(large.high! - large.low!).toBeLessThan(small.high! - small.low!)
  })
})

describe('日付', () => {
  it('月またぎ・うるう年でも日数を足せる', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
  })

  it('日本時間の今日を返す', () => {
    // UTC 2026-10-29 16:00 は日本時間 2026-10-30 01:00
    expect(todayInTokyo(new Date('2026-10-29T16:00:00Z'))).toBe('2026-10-30')
  })
})
