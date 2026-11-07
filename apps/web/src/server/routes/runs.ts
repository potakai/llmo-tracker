import { abandonRun, createManualRun, RunAlreadyActiveError } from '@llmo/runner'
import { Hono } from 'hono'
import { db } from '@/lib/db'
import type { AppDeps } from '../app'
import type { OrgEnv } from '../context'
import { errors } from '../errors'
import { getRunDetail, listRuns } from '../queries/runs'
import { brandParams, runParams } from '../schemas/brand'
import { validate } from '../validator'
import { findBrandInOrg } from './brands'

/** 実行（run）まわり。どれもブランドが自分の組織のものかを先に確かめる */
export const createRunRoutes = (deps: AppDeps) =>
  new Hono<OrgEnv>()
    // 手動実行：run を作ってジョブに渡す。結果はあとで一覧・詳細から見る
    .post('/:brandId/runs', validate('param', brandParams), async (c) => {
      const { brandId } = c.req.valid('param')
      const brand = await findBrandInOrg(c.var.organizationId, brandId)
      if (brand.prompts.length === 0) throw errors.noPrompts()

      let created: Awaited<ReturnType<typeof createManualRun>>
      try {
        created = await createManualRun(db, brand.id)
      } catch (error) {
        if (error instanceof RunAlreadyActiveError) throw errors.runAlreadyActive()
        throw error
      }
      try {
        await deps.dispatchRun(created.id)
      } catch (error) {
        // ジョブに渡せなかった run を残すと、30 分後の回収までそのブランドで実行できなくなる
        console.error('[run] ジョブに渡せませんでした', created.id, error)
        await abandonRun(db, created.id)
        throw errors.dispatchFailed()
      }
      return c.json({ run: created }, 202)
    })

    // 実行の一覧（新しい順に 20 件。回答の成功・失敗の数つき）
    .get('/:brandId/runs', validate('param', brandParams), async (c) => {
      const { brandId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)
      return c.json({ runs: await listRuns(brandId) })
    })

    // 実行の詳細（回答・引用元・分析結果つき）
    .get('/:brandId/runs/:runId', validate('param', runParams), async (c) => {
      const { brandId, runId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)
      const found = await getRunDetail(brandId, runId)
      if (!found) throw errors.notFound('実行')
      return c.json({ run: found })
    })
