import { brand, competitor, prompt } from '@llmo/db'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/lib/db'
import type { OrgEnv } from '../context'
import { errors } from '../errors'
import {
  brandParams,
  competitorInput,
  competitorParams,
  createPromptInput,
  MAX_ACTIVE_PROMPTS,
  MAX_COMPETITORS,
  promptParams,
  updateBrandInput,
  updateCompetitorInput,
} from '../schemas/brand'
import { validate } from '../validator'
import { findBrandInOrg } from './brands'

/** Postgres の一意制約違反（23505）か */
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'cause' in error &&
  (error.cause as { code?: string } | undefined)?.code === '23505'

/**
 * ブランドの設定（ブランド情報・競合・質問）。
 * 質問は「文面の書き換え」をさせない。文面が変わると過去の計測と比べられなくなるので、
 * 変えたいときはアーカイブして新しく追加してもらう。
 */
export const settingsRoutes = new Hono<OrgEnv>()
  // ブランド情報
  .patch(
    '/:brandId',
    validate('param', brandParams),
    validate('json', updateBrandInput),
    async (c) => {
      const { brandId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)
      await db.update(brand).set(c.req.valid('json')).where(eq(brand.id, brandId))
      return c.json({ brand: await findBrandInOrg(c.var.organizationId, brandId) })
    },
  )

  // 競合を追加
  .post(
    '/:brandId/competitors',
    validate('param', brandParams),
    validate('json', competitorInput),
    async (c) => {
      const { brandId } = c.req.valid('param')
      const found = await findBrandInOrg(c.var.organizationId, brandId)
      if (found.competitors.length >= MAX_COMPETITORS) {
        return c.json(
          { error: { code: 'COMPETITOR_LIMIT', message: `競合は${MAX_COMPETITORS}社までです` } },
          400,
        )
      }
      const input = c.req.valid('json')
      try {
        const [created] = await db
          .insert(competitor)
          .values({
            brandId,
            name: input.name,
            aliases: input.aliases,
            domain: input.domain ?? null,
          })
          .returning()
        return c.json({ competitor: created }, 201)
      } catch (error) {
        if (isUniqueViolation(error)) throw errors.duplicate('名前の競合')
        throw error
      }
    },
  )

  // 競合を変更（名前を変えても、過去の言及はこの競合にひもづいたまま）
  .patch(
    '/:brandId/competitors/:competitorId',
    validate('param', competitorParams),
    validate('json', updateCompetitorInput),
    async (c) => {
      const { brandId, competitorId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)
      try {
        const [updated] = await db
          .update(competitor)
          .set(c.req.valid('json'))
          .where(and(eq(competitor.id, competitorId), eq(competitor.brandId, brandId)))
          .returning()
        if (!updated) throw errors.notFound('競合')
        return c.json({ competitor: updated })
      } catch (error) {
        if (isUniqueViolation(error)) throw errors.duplicate('名前の競合')
        throw error
      }
    },
  )

  // 競合を削除（過去の言及は名前だけ残る）
  .delete('/:brandId/competitors/:competitorId', validate('param', competitorParams), async (c) => {
    const { brandId, competitorId } = c.req.valid('param')
    await findBrandInOrg(c.var.organizationId, brandId)
    const [deleted] = await db
      .delete(competitor)
      .where(and(eq(competitor.id, competitorId), eq(competitor.brandId, brandId)))
      .returning({ id: competitor.id })
    if (!deleted) throw errors.notFound('競合')
    return c.body(null, 204)
  })

  // 質問を追加（有効な質問は MAX_ACTIVE_PROMPTS 個まで）
  .post(
    '/:brandId/prompts',
    validate('param', brandParams),
    validate('json', createPromptInput),
    async (c) => {
      const { brandId } = c.req.valid('param')
      await findBrandInOrg(c.var.organizationId, brandId)
      const { text } = c.req.valid('json')
      const created = await db.transaction(async (tx) => {
        await lockBrand(tx, brandId)
        await assertPromptSlot(tx, brandId)
        const [duplicate] = await tx
          .select({ id: prompt.id })
          .from(prompt)
          .where(and(eq(prompt.brandId, brandId), isNull(prompt.archivedAt), eq(prompt.text, text)))
          .limit(1)
        if (duplicate) throw errors.duplicate('質問')
        const [row] = await tx.insert(prompt).values({ brandId, text }).returning()
        return row
      })
      return c.json({ prompt: created }, 201)
    },
  )

  // 質問をアーカイブ（計測の対象から外す。過去の回答は残る）
  .post('/:brandId/prompts/:promptId/archive', validate('param', promptParams), async (c) => {
    const { brandId, promptId } = c.req.valid('param')
    await findBrandInOrg(c.var.organizationId, brandId)
    const [updated] = await db
      .update(prompt)
      .set({ archivedAt: sql`coalesce(${prompt.archivedAt}, now())` })
      .where(and(eq(prompt.id, promptId), eq(prompt.brandId, brandId)))
      .returning()
    if (!updated) throw errors.notFound('質問')
    return c.json({ prompt: updated })
  })

  // アーカイブした質問を元に戻す
  .post('/:brandId/prompts/:promptId/restore', validate('param', promptParams), async (c) => {
    const { brandId, promptId } = c.req.valid('param')
    await findBrandInOrg(c.var.organizationId, brandId)
    const restored = await db.transaction(async (tx) => {
      await lockBrand(tx, brandId)
      await assertPromptSlot(tx, brandId)
      const [row] = await tx
        .update(prompt)
        .set({ archivedAt: null })
        .where(and(eq(prompt.id, promptId), eq(prompt.brandId, brandId)))
        .returning()
      return row
    })
    if (!restored) throw errors.notFound('質問')
    return c.json({ prompt: restored })
  })

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** 同じブランドへの質問の追加が同時に来ても、上限を超えないようにブランドの行をロックする */
async function lockBrand(tx: Tx, brandId: string) {
  await tx.select({ id: brand.id }).from(brand).where(eq(brand.id, brandId)).for('update')
}

async function assertPromptSlot(tx: Tx, brandId: string) {
  const [row] = await tx
    .select({ active: count() })
    .from(prompt)
    .where(and(eq(prompt.brandId, brandId), isNull(prompt.archivedAt)))
  if ((row?.active ?? 0) >= MAX_ACTIVE_PROMPTS) throw errors.promptLimit(MAX_ACTIVE_PROMPTS)
}
