import { Hono } from 'hono'
import { auth } from '@/lib/auth'
import type { AppEnv } from './context'
import { handleError } from './errors'
import { loadSession, requireAuth, requireOrg } from './middleware/auth'
import { brandRoutes } from './routes/brands'
import { createRunRoutes } from './routes/runs'

/** 外から差し替えるもの。本番・開発・テストで中身を変える */
export type AppDeps = {
  /**
   * run をジョブとして投げる。
   * 開発ではリクエストのあとに同じプロセスで実行、テストではその場で実行して待つ、
   * 本番では Trigger.dev に渡す（予定）
   */
  dispatchRun: (runId: string) => Promise<void> | void
}

/**
 * API の入口。Next.js の app/api/[[...route]]/route.ts から呼ばれる。
 *
 * /api/auth/*  … Better Auth（サインアップ、ログイン、組織の作成など）
 * /api/brands  … ログイン済み＋組織を選択済みのときだけ通る
 */
export function createApp(deps: AppDeps) {
  return new Hono<AppEnv>()
    .basePath('/api')
    .onError(handleError)
    .on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
    .get('/health', (c) => c.json({ ok: true }))
    .use('/brands/*', loadSession, requireAuth, requireOrg)
    .use('/brands', loadSession, requireAuth, requireOrg)
    .route('/brands', brandRoutes)
    .route('/brands', createRunRoutes(deps))
}

/** フロントから hc<AppType>() で型付きで呼ぶための型 */
export type AppType = ReturnType<typeof createApp>
