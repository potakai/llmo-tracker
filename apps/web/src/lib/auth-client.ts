'use client'
import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** ブラウザから Better Auth を呼ぶクライアント（同じオリジンの /api/auth を使う） */
export const authClient = createAuthClient({ plugins: [organizationClient()] })
