import { describe, expect, it } from 'vitest'
import { bySeverity, type ComparableCheck, diffChecks } from '@/lib/site-audit-diff'

const A = 'https://maru.example.com/a'
const B = 'https://maru.example.com/b'
const check = (pageUrl: string | null, key: string, status: ComparableCheck['status']) => ({
  pageUrl,
  key,
  status,
  message: `${key}:${status}`,
})
const pages = (fetched: string[], failed: string[] = []) => ({
  fetched: new Set(fetched),
  audited: new Set([...fetched, ...failed]),
})

describe('前回の診断からの変化', () => {
  it('前回は問題があり、今回は問題なしになった項目を「直った」、その逆を「新しく出た」にする', () => {
    const result = diffChecks(
      [check(null, 'llms_txt', 'warning'), check(A, 'title', 'critical'), check(A, 'h1', 'ok')],
      [check(null, 'llms_txt', 'ok'), check(A, 'title', 'ok'), check(A, 'h1', 'warning')],
      { previous: pages([A]), current: pages([A]) },
    )
    expect(result.fixed.map((c) => c.key)).toEqual(['llms_txt', 'title'])
    expect(result.appeared.map((c) => c.key)).toEqual(['h1'])
  })

  it('読めなかったページが読めるようになったら、読めなかった項目は「直った」にする', () => {
    const result = diffChecks([check(A, 'fetch', 'critical')], [check(A, 'title', 'ok')], {
      previous: pages([], [A]),
      current: pages([A]),
    })
    expect(result.fixed.map((c) => c.key)).toEqual(['fetch'])
  })

  it('今回読めなかったページの項目は「直った」にせず、今回初めて診断したページの問題は「新しく出た」にしない', () => {
    const result = diffChecks(
      [check(A, 'title', 'critical')],
      [check(A, 'fetch', 'critical'), check(B, 'title', 'critical')],
      { previous: pages([A]), current: pages([B], [A]) },
    )
    expect(result.fixed).toEqual([])
    // A の fetch は前回 A を診断しているので「新しく出た」。B は今回が初めてなので数えない
    expect(result.appeared.map((c) => [c.pageUrl, c.key])).toEqual([[A, 'fetch']])
  })

  it('注意から要対応に変わっただけなら、どちらにも入れない', () => {
    const result = diffChecks([check(A, 'title', 'warning')], [check(A, 'title', 'critical')], {
      previous: pages([A]),
      current: pages([A]),
    })
    expect(result).toEqual({ fixed: [], appeared: [] })
  })

  it('要対応 → 注意 → 問題なし の順に並べる', () => {
    const list = [check(null, 'a', 'ok'), check(null, 'b', 'warning'), check(null, 'c', 'critical')]
    expect(bySeverity(list).map((c) => c.key)).toEqual(['c', 'b', 'a'])
  })
})
