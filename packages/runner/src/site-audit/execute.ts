import type { SiteAuditDeps } from './deps'
import { abandonSiteAudit, finishSiteAudit } from './finish'
import { auditPagesSlice } from './pages'
import { prepareSiteAudit, siteUnreachableMessage } from './plan'

/**
 * 診断の 1 段目を動かし、サイトに届かなければ（robots.txt が通信のエラーで読めない）、理由付きで失敗にする。
 * それ以外のエラーはそのまま投げる（ジョブがリトライする）
 */
export async function prepareOrFail(deps: SiteAuditDeps, auditId: string) {
  try {
    return await prepareSiteAudit(deps, auditId)
  } catch (error) {
    const message = siteUnreachableMessage(error)
    if (!message) throw error
    await abandonSiteAudit(deps.db, auditId, message)
    return { kind: 'finished' as const }
  }
}

/**
 * 診断を最後まで同じプロセスで動かす（開発・テスト・デモのデータ作り用）。本番は Inngest のステップに分けて動かす
 */
export async function executeSiteAudit(deps: SiteAuditDeps, auditId: string): Promise<void> {
  try {
    const prepared = await prepareOrFail(deps, auditId)
    if (prepared.kind === 'finished') return
    let remaining: number
    do {
      ;({ remaining } = await auditPagesSlice(deps, auditId, {
        budgetMs: Number.POSITIVE_INFINITY,
      }))
    } while (remaining > 0)
    await finishSiteAudit(deps.db, auditId)
  } catch (error) {
    await abandonSiteAudit(deps.db, auditId, '診断の途中でエラーが起きました')
    throw error
  }
}
