import type { auth } from '@/lib/auth'

type Session = typeof auth.$Infer.Session

/** Hono の c.var に載せる値。ミドルウェアを通ったあとで型が絞られる */
export type AppEnv = {
  Variables: {
    user: Session['user'] | null
    session: Session['session'] | null
  }
}

/** requireAuth を通ったあと */
export type AuthedEnv = {
  Variables: {
    user: Session['user']
    session: Session['session']
  }
}

/** requireOrg を通ったあと：操作対象の組織が決まっている */
export type OrgEnv = {
  Variables: AuthedEnv['Variables'] & {
    organizationId: string
  }
}
