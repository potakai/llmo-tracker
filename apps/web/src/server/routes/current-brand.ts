import { Hono } from 'hono'
import type { OrgEnv } from '../context'
import { rememberBrand } from '../current-brand'
import { errors } from '../errors'
import { findBrandSummary } from '../queries/brands'
import { brandParams } from '../schemas/brand'
import { validate } from '../validator'

/**
 * 今見ているブランドの切り替え。Cookie に覚えるだけで、DB には書かない。
 * 見るだけの操作なので、デモの組織でも使える（app.ts で blockDemoWrites を通さない）
 */
export const currentBrandRoutes = new Hono<OrgEnv>().put(
  '/',
  validate('json', brandParams),
  async (c) => {
    const { brandId } = c.req.valid('json')
    const found = await findBrandSummary(c.var.organizationId, brandId)
    if (!found) throw errors.notFound('ブランド')
    rememberBrand(c, found.id)
    return c.json({ brand: found })
  },
)
