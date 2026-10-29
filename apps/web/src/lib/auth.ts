import * as schema from '@llmo/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { db } from './db'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: false }),
  emailAndPassword: { enabled: true },
  // 組織 = テナント。招待とロールは v2 で使う
  plugins: [organization()],
  advanced: {
    database: { generateId: 'uuid' },
  },
})
