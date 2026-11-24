import type { CheckStatus } from '@llmo/db'

/** 比べる項目。pageUrl が null ならサイト全体の項目 */
export type ComparableCheck = {
  pageUrl: string | null
  key: string
  status: CheckStatus
  message: string
}

/** 比べる回で、ページを読めたか（読めなかった・読んでいないページの項目は「直った」にしない） */
export type AuditedPages = { fetched: Set<string>; audited: Set<string> }

export type CheckChanges = {
  /** 前回は注意・要対応で、今回は問題なしになった（または原因の項目が出なくなった） */
  fixed: ComparableCheck[]
  /** 前回は問題なし（またはなかった）で、今回は注意・要対応になった */
  appeared: ComparableCheck[]
}

const identity = (c: Pick<ComparableCheck, 'pageUrl' | 'key'>) => `${c.pageUrl ?? ''}\u0000${c.key}`
const isIssue = (c: ComparableCheck | undefined) => c !== undefined && c.status !== 'ok'

/**
 * 前回の診断からの変化。同じページ（URL）の同じ項目どうしを比べる。
 * - 直った：前回は問題があり、今回はそのページを読めて、その項目が問題なし（または出なくなった）
 * - 新しく出た：今回は問題があり、前回もそのページを診断していて、その項目は問題がなかった（またはなかった）
 * 片方の回でしか診断していないページは、比べようがないので数えない
 */
export function diffChecks(
  previous: ComparableCheck[],
  current: ComparableCheck[],
  pages: { previous: AuditedPages; current: AuditedPages },
): CheckChanges {
  const prevById = new Map(previous.map((c) => [identity(c), c]))
  const currById = new Map(current.map((c) => [identity(c), c]))
  const inScope = (url: string | null, audited: Set<string>) => url === null || audited.has(url)

  const fixed = previous.filter((before) => {
    if (!isIssue(before)) return false
    if (!inScope(before.pageUrl, pages.current.fetched)) return false
    return !isIssue(currById.get(identity(before)))
  })
  const appeared = current.filter((now) => {
    if (!isIssue(now)) return false
    if (!inScope(now.pageUrl, pages.previous.audited)) return false
    return !isIssue(prevById.get(identity(now)))
  })
  return { fixed, appeared }
}

const SEVERITY: Record<CheckStatus, number> = { critical: 0, warning: 1, ok: 2 }

/** 要対応 → 注意 → 問題なし の順に並べる（同じなら元の順） */
export function bySeverity<T extends { status: CheckStatus }>(list: T[]): T[] {
  return [...list].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])
}
