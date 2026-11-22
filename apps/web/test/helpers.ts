import { createFakeProvider, createRuleBasedExtractor } from '@llmo/llm'
import { executeRun } from '@llmo/runner'
import { db } from '@/lib/db'
import { createApp } from '@/server/app'

/** テストでは run をその場で実行して待つ（フェイクの AI を使う） */
export const app = createApp({
  dispatchRun: async (runId) => {
    await executeRun(
      {
        db,
        providers: { openai: createFakeProvider('openai'), gemini: createFakeProvider('gemini') },
        extractor: createRuleBasedExtractor(),
      },
      runId,
    )
  },
})

const ORIGIN = 'http://localhost:3000'

/**
 * ブラウザの代わり。Cookie を覚えておいて、次のリクエストに付ける。
 * サーバーは立てずに app.request() で Hono を直接呼ぶ。
 */
/** リクエストを受けるもの：Hono のアプリ、または Next.js の Route Handler（routeHandlerTarget で包む） */
export type RequestTarget = {
  request: (url: string, init: RequestInit) => Response | Promise<Response>
}

/** Next.js の Route Handler（app/api/.../route.ts が export する GET / POST など）をテストから呼べる形にする */
export function routeHandlerTarget(
  handlers: Record<'GET' | 'POST', (req: Request) => Response | Promise<Response>>,
): RequestTarget {
  return {
    request: (url, init) => {
      const method = init.method === 'POST' ? 'POST' : 'GET'
      return handlers[method](new Request(url, init))
    },
  }
}

export class TestClient {
  private cookies = new Map<string, string>()

  /** 別の依存（失敗するジョブなど）で作ったアプリや、本番と同じ Route Handler を渡すこともできる */
  constructor(private readonly target: RequestTarget = app) {}

  async request(method: string, path: string, body?: unknown) {
    const headers = new Headers({ origin: ORIGIN })
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const res = await this.target.request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';')
      const index = pair?.indexOf('=') ?? -1
      if (pair && index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    // biome-ignore lint/suspicious/noExplicitAny: テストでは JSON をそのまま見る
    const json = (await res.json().catch(() => null)) as any
    return { status: res.status, json }
  }

  /** ブラウザが覚えている Cookie の値（なければ undefined） */
  cookie(name: string) {
    return this.cookies.get(name)
  }

  get = (path: string) => this.request('GET', path)
  post = (path: string, body: unknown) => this.request('POST', path, body)

  /** サインアップ（ログイン状態になる） */
  async signUp(name: string) {
    const email = `${name}-${crypto.randomUUID()}@example.com`
    return this.post('/api/auth/sign-up/email', { name, email, password: 'password-1234' })
  }

  /** 組織を作る（作った組織がアクティブになる） */
  async createOrganization(name: string) {
    return this.post('/api/auth/organization/create', {
      name,
      slug: `${name.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
    })
  }
}
