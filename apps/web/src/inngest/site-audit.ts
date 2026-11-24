import {
  abandonSiteAudit,
  auditPagesSlice,
  createScheduledSiteAudits,
  finishSiteAudit,
  prepareOrFail,
  recoverStaleSiteAudits,
  SiteAuditNotFoundError,
  tokyoDate,
} from '@llmo/runner'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { getSitePolicy, siteAuditDeps } from '@/lib/site'
import { inngest } from './client'
import { createSiteAuditRequestedEvent, siteAuditRequested } from './events'

// 中身はすべて packages/runner にある。ここはそれを Inngest のステップに載せるだけ

/**
 * 1 ステップで、新しいページを読み始めてよい時間。読み途中のページは待つので、1 ステップは最長で
 * これ + 1 ページのタイムアウト（10 秒。packages/site の SITE_FETCH_LIMITS）+ DB の読み書き くらい
 */
const SLICE_BUDGET_MS = 45_000
/** 同時に動かす診断の数（外のサイトを読むので控えめに） */
const MAX_CONCURRENT_AUDITS = 2

/** NotFound（ブランドの削除などで診断が消えた）はリトライしない */
async function orNonRetriable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof SiteAuditNotFoundError) throw new NonRetriableError(error.message)
    throw error
  }
}

/**
 * サイト診断を 1 つ動かす：ページの一覧を作る → ページを予算ごとに読む → サイト全体をまとめる。
 * どのステップで落ちても、次は DB の続きから再開する
 */
export const executeSiteAuditFunction = inngest.createFunction(
  {
    id: 'execute-site-audit',
    triggers: [siteAuditRequested],
    concurrency: [{ limit: MAX_CONCURRENT_AUDITS }, { key: 'event.data.auditId', limit: 1 }],
    onFailure: async ({ event, logger }) => {
      const auditId = event.data.event.data.auditId
      const closed = await abandonSiteAudit(db, auditId, '診断の途中でエラーが起きました')
      if (closed) logger.warn('ジョブが失敗したので、サイト診断を終わらせました', { auditId })
    },
  },
  async ({ event, step, logger }) => {
    const { auditId } = event.data
    const prepared = await step.run('prepare', () =>
      orNonRetriable(() => prepareOrFail(siteAuditDeps(), auditId)),
    )
    if (prepared.kind === 'finished') return { auditId, finished: 'early' }

    for (let slice = 1; ; slice += 1) {
      const result = await step.run(`pages-${slice}`, () =>
        orNonRetriable(() =>
          auditPagesSlice(siteAuditDeps(), auditId, { budgetMs: SLICE_BUDGET_MS }),
        ),
      )
      if (result.remaining === 0) break
    }
    await step.run('finish', () => finishSiteAudit(db, auditId))
    logger.info('サイト診断が終わりました', { auditId })
    return { auditId }
  },
)

/**
 * 週 1 回の自動の診断（毎週月曜 5 時、日本時間）。ドメインを登録しているブランドごとに診断を作って渡す
 */
export const siteAuditWeeklyFunction = inngest.createFunction(
  { id: 'site-audit-weekly', triggers: [{ cron: 'TZ=Asia/Tokyo 0 5 * * 1' }] },
  async ({ event, step, logger }) => {
    const date = tokyoDate(new Date(event.ts ?? Date.now()))
    const result = await step.run('create', () =>
      createScheduledSiteAudits(db, date, getSitePolicy().modeFor),
    )
    if (result.toDispatch.length > 0) {
      await step.sendEvent('dispatch', result.toDispatch.map(createSiteAuditRequestedEvent))
    }
    const summary = { date, created: result.created, dispatched: result.toDispatch.length }
    logger.info('今週のサイト診断を作りました', summary)
    return summary
  },
)

/** 止まったサイト診断の回収（30 分ごと）。2 時間なにも進んでいない診断を、理由付きで失敗にする */
export const recoverStaleSiteAuditsFunction = inngest.createFunction(
  { id: 'recover-stale-site-audits', triggers: [{ cron: '*/30 * * * *' }] },
  async ({ step, logger }) => {
    const recovered = await step.run('recover', () => recoverStaleSiteAudits(db))
    if (recovered > 0) logger.warn('止まっていたサイト診断を終わらせました', { recovered })
    return { recovered }
  },
)
