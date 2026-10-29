import { citation, response, run } from '@llmo/db'
import { createManualRun, RunAlreadyActiveError } from '@llmo/runner'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/lib/db'
import type { AppDeps } from '../app'
import type { OrgEnv } from '../context'
import { errors } from '../errors'
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
      await deps.dispatchRun(created.id)
      return c.json({ run: created }, 202)
    })

    // 実行の一覧（新しい順に 20 件。回答の成功・失敗の数つき）
    .get('/:brandId/runs', validate('param', brandParams), async (c) => {
      const { brandId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)

      const runs = await db
        .select({
          id: run.id,
          trigger: run.trigger,
          status: run.status,
          scheduledFor: run.scheduledFor,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          totalCostUsd: run.totalCostUsd,
          createdAt: run.createdAt,
          succeeded: sql<number>`count(${response.id}) filter (where ${response.status} = 'succeeded')::int`,
          failed: sql<number>`count(${response.id}) filter (where ${response.status} = 'failed')::int`,
        })
        .from(run)
        .leftJoin(response, eq(response.runId, run.id))
        .where(eq(run.brandId, brandId))
        .groupBy(run.id)
        .orderBy(desc(run.createdAt))
        .limit(20)
      return c.json({ runs })
    })

    // 実行の詳細（回答と引用元つき）
    .get('/:brandId/runs/:runId', validate('param', runParams), async (c) => {
      const { brandId, runId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)

      const found = await db.query.run.findFirst({
        where: and(eq(run.id, runId), eq(run.brandId, brandId)),
        with: {
          responses: {
            orderBy: [asc(response.promptId), asc(response.provider), asc(response.sampleIndex)],
            with: { citations: { orderBy: asc(citation.position) } },
          },
        },
      })
      if (!found) throw errors.notFound('実行')
      return c.json({ run: found })
    })
