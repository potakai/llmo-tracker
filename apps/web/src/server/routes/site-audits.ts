import {
  createManualSiteAudit,
  discardQueuedSiteAudit,
  SiteAuditAlreadyActiveError,
  SiteAuditDailyLimitError,
  tokyoDate,
} from '@llmo/runner'
import { Hono } from 'hono'
import { db } from '@/lib/db'
import { getSitePolicy } from '@/lib/site'
import type { OrgEnv } from '../context'
import { errors } from '../errors'
import { brandParams } from '../schemas/brand'
import { validate } from '../validator'
import { findBrandInOrg } from './brands'

type Dispatch = (auditId: string) => Promise<void> | void

/** サイト診断。ブランドが自分の組織のものかを先に確かめる（他の組織のブランドは 404） */
export const createSiteAuditRoutes = (dispatch: Dispatch) =>
  new Hono<OrgEnv>()
    // 今すぐ診断：1 ブランド 1 日 1 回まで。デモ組織は blockDemoWrites で 403
    .post('/:brandId/site-audits', validate('param', brandParams), async (c) => {
      const { brandId } = c.req.valid('param')
      const organizationId = c.var.organizationId
      const brand = await findBrandInOrg(organizationId, brandId)
      if (!brand.domain) throw errors.noDomain()

      let created: Awaited<ReturnType<typeof createManualSiteAudit>>
      try {
        created = await createManualSiteAudit(db, {
          brandId: brand.id,
          domain: brand.domain,
          mode: getSitePolicy().modeFor(organizationId),
          date: tokyoDate(new Date()),
        })
      } catch (error) {
        if (error instanceof SiteAuditDailyLimitError) throw errors.siteAuditDailyLimit()
        if (error instanceof SiteAuditAlreadyActiveError) throw errors.siteAuditActive()
        throw error
      }
      try {
        await dispatch(created.id)
      } catch (error) {
        // ジョブに渡せなかった診断は消す（残すと、今日はもう押せなくなる）
        console.error('[site-audit] ジョブに渡せませんでした', created.id, error)
        await discardQueuedSiteAudit(db, created.id)
        throw errors.dispatchFailed()
      }
      return c.json({ siteAudit: { id: created.id, status: created.status } }, 202)
    })
