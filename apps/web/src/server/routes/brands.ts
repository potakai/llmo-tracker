import { brand, competitor, prompt } from '@llmo/db'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/lib/db'
import type { OrgEnv } from '../context'
import { errors } from '../errors'
import { brandParams, createBrandInput } from '../schemas/brand'
import { validate } from '../validator'

/** 組織の中のブランドを1件取る。他の組織のものなら 404 */
export async function findBrandInOrg(organizationId: string, brandId: string) {
  const found = await db.query.brand.findFirst({
    where: and(eq(brand.id, brandId), eq(brand.organizationId, organizationId)),
    with: {
      competitors: { orderBy: asc(competitor.createdAt) },
      prompts: {
        where: isNull(prompt.archivedAt),
        orderBy: asc(prompt.createdAt),
      },
    },
  })
  if (!found) throw errors.notFound('ブランド')
  return found
}

export const brandRoutes = new Hono<OrgEnv>()
  // 組織のブランド一覧
  .get('/', async (c) => {
    const rows = await db
      .select()
      .from(brand)
      .where(eq(brand.organizationId, c.var.organizationId))
      .orderBy(desc(brand.createdAt))
    return c.json({ brands: rows })
  })

  // ブランドを登録（競合と質問も一緒に。全部入るか、全部入らないか）
  .post('/', validate('json', createBrandInput), async (c) => {
    const input = c.req.valid('json')
    const organizationId = c.var.organizationId

    const brandId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(brand)
        .values({
          organizationId,
          name: input.name,
          aliases: input.aliases,
          domain: input.domain ?? null,
          samplesPerPrompt: input.samplesPerPrompt,
          providers: input.providers,
        })
        .returning({ id: brand.id })
      if (!created) throw new Error('brand の作成に失敗しました')

      if (input.competitors.length > 0) {
        await tx.insert(competitor).values(
          input.competitors.map((comp) => ({
            brandId: created.id,
            name: comp.name,
            aliases: comp.aliases,
            domain: comp.domain ?? null,
          })),
        )
      }
      await tx.insert(prompt).values(input.prompts.map((text) => ({ brandId: created.id, text })))
      return created.id
    })

    return c.json({ brand: await findBrandInOrg(organizationId, brandId) }, 201)
  })

  // ブランドの詳細（競合と有効な質問つき）
  .get('/:brandId', validate('param', brandParams), async (c) => {
    const { brandId } = c.req.valid('param')
    return c.json({ brand: await findBrandInOrg(c.var.organizationId, brandId) })
  })
