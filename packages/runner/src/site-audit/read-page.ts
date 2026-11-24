import {
  type CheckResult,
  checkPage,
  extractPageFacts,
  type FetchedResource,
  fetchFailure,
  httpStatusMessage,
  SiteFetchError,
  type SiteFetcher,
} from '@llmo/site'

/** 読んだ結果。ページの行の更新と、ページごとの項目 */
export type PageOutcome = {
  status: 'fetched' | 'failed' | 'skipped'
  httpStatus: number | null
  finalUrl: string | null
  facts: unknown
  error: string | null
  checks: CheckResult[]
}

const empty = { httpStatus: null, finalUrl: null, facts: null, checks: [] }

/** 診断の対象外（問題ではない）として、読まずに飛ばす理由 */
const SKIPPED_REASONS = new Set(['unsupported_type', 'robots_disallowed'])

/**
 * 1 ページを読んで診断する。読めなかったことも結果として返す（例外にしない）。
 * links はページの中のリンク（sitemap がないときに、ページの一覧を作るのに使う）
 */
export async function readPage(
  fetcher: SiteFetcher,
  url: string,
  names: string[],
): Promise<{ outcome: PageOutcome; links: string[] }> {
  let res: FetchedResource
  try {
    res = await fetcher.fetch(url)
  } catch (error) {
    if (!(error instanceof SiteFetchError)) throw error
    // PDF や画像、robots.txt で止められたページは、読まずに飛ばす
    if (SKIPPED_REASONS.has(error.reason)) {
      return { outcome: { ...empty, status: 'skipped', error: error.message }, links: [] }
    }
    const checks = [fetchFailure(error.message, { reason: error.reason })]
    return { outcome: { ...empty, status: 'failed', error: error.message, checks }, links: [] }
  }
  if (res.status < 200 || res.status >= 300) {
    const message = httpStatusMessage(res.status)
    return {
      outcome: {
        ...empty,
        status: 'failed',
        httpStatus: res.status,
        finalUrl: res.url,
        error: message,
        checks: [fetchFailure(message, { httpStatus: res.status })],
      },
      links: [],
    }
  }
  const { links, ...facts } = extractPageFacts(res.body, {
    url: res.url,
    names,
    xRobotsTag: res.xRobotsTag,
  })
  return {
    outcome: {
      status: 'fetched',
      httpStatus: res.status,
      finalUrl: res.url,
      facts,
      error: null,
      checks: checkPage({ url: res.url, facts: { ...facts, links: [] }, names }),
    },
    links,
  }
}

export async function auditPage(
  fetcher: SiteFetcher,
  url: string,
  names: string[],
): Promise<PageOutcome> {
  return (await readPage(fetcher, url, names)).outcome
}

/** site_audit_page の行に入れる値（fetchedAt は呼び出し側で入れる） */
export function pageRowValues(outcome: PageOutcome) {
  return {
    status: outcome.status,
    httpStatus: outcome.httpStatus,
    finalUrl: outcome.finalUrl,
    facts: outcome.facts,
    error: outcome.error,
  }
}

/** site_audit_check の行 */
export function checkRows(auditId: string, pageId: string | null, checks: CheckResult[]) {
  return checks.map((c) => ({
    auditId,
    pageId,
    key: c.key,
    status: c.status,
    message: c.message,
    detail: c.detail ?? null,
  }))
}
