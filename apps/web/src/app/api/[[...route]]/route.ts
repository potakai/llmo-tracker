import { handle } from 'hono/vercel'
import { createApp } from '@/server/app'
import { selectDispatcher, selectSiteAuditDispatcher } from '@/server/dispatch'

const app = createApp({
  dispatchRun: selectDispatcher(),
  dispatchSiteAudit: selectSiteAuditDispatcher(),
})

// Hono のアプリを Next.js の Route Handler として動かす
export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
