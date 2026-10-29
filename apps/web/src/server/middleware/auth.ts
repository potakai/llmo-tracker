import { member } from '@llmo/db'
import { and, eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import type { AppEnv, AuthedEnv, OrgEnv } from '../context'
import { errors } from '../errors'

/** Cookie からセッションを読んで c.var に載せる（未ログインなら null） */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('user', result?.user ?? null)
  c.set('session', result?.session ?? null)
  await next()
})

/** ログイン必須 */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.var.user || !c.var.session) throw errors.unauthorized()
  await next()
})

/**
 * 操作対象の組織を決める。
 * セッションの「アクティブな組織」を使い、今もその組織のメンバーかを DB で確かめる
 * （組織から外されたあとに古いセッションで操作されるのを防ぐ）。
 */
export const requireOrg = createMiddleware<OrgEnv>(async (c, next) => {
  const organizationId = c.var.session.activeOrganizationId
  if (!organizationId) throw errors.noActiveOrganization()

  const membership = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, c.var.user.id)))
    .limit(1)
  if (membership.length === 0) throw errors.forbidden()

  c.set('organizationId', organizationId)
  await next()
})
