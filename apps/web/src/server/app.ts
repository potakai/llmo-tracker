import { Hono } from 'hono'
import { auth } from '@/lib/auth'
import type { AppEnv } from './context'
import { isDemoOrganization } from './demo'
import { errors, handleError } from './errors'
import { blockDemoWrites, loadSession, requireAuth, requireOrg } from './middleware/auth'
import { brandRoutes } from './routes/brands'
import { createRunRoutes } from './routes/runs'
import { settingsRoutes } from './routes/settings'

/** 外から差し替えるもの。本番・開発・テストで中身を変える */
export type AppDeps = {
  /**
   * run をジョブとして投げる。
   * 開発ではリクエストのあとに同じプロセスで実行、テストではその場で実行して待つ、
   * 本番では Trigger.dev に渡す（予定）
   */
  dispatchRun: (runId: string) => Promise<void> | void
}

/** デモのユーザーでも使ってよい Better Auth の書き込み系（ログイン・ログアウト・別アカウントの作成） */
const AUTH_WRITES_ALLOWED_FOR_DEMO = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-out',
  '/api/auth/sign-up/email',
])

/**
 * API の入口。Next.js の app/api/[[...route]]/route.ts から呼ばれる。
 *
 * /api/auth/*  … Better Auth（サインアップ、ログイン、組織の作成など）
 * /api/brands  … ログイン済み＋組織を選択済みのときだけ通る。デモ組織は読み取りだけ
 */
export function createApp(deps: AppDeps) {
  return new Hono<AppEnv>()
    .basePath('/api')
    .onError(handleError)
    .on(['GET', 'POST'], '/auth/*', async (c) => {
      // デモ組織のユーザーには、組織の作成やパスワード変更などをさせない
      if (c.req.method === 'POST' && !AUTH_WRITES_ALLOWED_FOR_DEMO.has(c.req.path)) {
        const session = await auth.api.getSession({ headers: c.req.raw.headers })
        const orgId = session?.session.activeOrganizationId
        if (orgId && (await isDemoOrganization(orgId))) throw errors.demoReadOnly()
      }
      return auth.handler(c.req.raw)
    })
    .get('/health', (c) => c.json({ ok: true }))
    .use('/brands/*', loadSession, requireAuth, requireOrg, blockDemoWrites)
    .use('/brands', loadSession, requireAuth, requireOrg, blockDemoWrites)
    .route('/brands', brandRoutes)
    .route('/brands', settingsRoutes)
    .route('/brands', createRunRoutes(deps))
}

/** フロントから hc<AppType>() で型付きで呼ぶための型 */
export type AppType = ReturnType<typeof createApp>
