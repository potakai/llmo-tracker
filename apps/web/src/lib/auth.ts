import * as schema from '@llmo/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { asc, eq } from 'drizzle-orm'
import { db } from './db'

/**
 * 開発中は localhost のどのポートからでもログインできるようにする
 * （3000 番が使用中だと Next.js は 3001 番などで起動するため）。本番は BETTER_AUTH_URL だけ。
 */
const devOrigins =
  process.env.NODE_ENV === 'production'
    ? []
    : Array.from({ length: 11 }, (_, i) => 3000 + i).flatMap((port) => [
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ])

export const auth = betterAuth({
  trustedOrigins: devOrigins,
  database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: false }),
  emailAndPassword: { enabled: true },
  // 組織 = テナント。招待とロールは v2 で使う
  plugins: [organization()],
  advanced: {
    database: { generateId: 'uuid' },
  },
  databaseHooks: {
    session: {
      create: {
        // ログインしたら、所属している最初の組織を「操作中の組織」にしておく
        before: async (session) => {
          const [first] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1)
          return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } }
        },
      },
    },
  },
})
