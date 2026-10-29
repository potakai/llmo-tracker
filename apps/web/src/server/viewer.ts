import 'server-only'
import { member } from '@llmo/db'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

/** 画面（Server Component）用：ログイン中のユーザーと操作中の組織。API の requireOrg と同じ確認をする */
export async function getViewer() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const organizationId = session.session.activeOrganizationId ?? null
  if (!organizationId) return { user: session.user, organizationId: null }

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
    .limit(1)
  return { user: session.user, organizationId: membership ? organizationId : null }
}

/** ログイン必須の画面。未ログインならログインへ、組織がなければ初期設定へ */
export async function requireViewerWithOrg() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  if (!viewer.organizationId) redirect('/onboarding')
  return { ...viewer, organizationId: viewer.organizationId }
}
