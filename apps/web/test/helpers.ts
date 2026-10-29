import { createFakeProvider } from '@llmo/llm'
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
export class TestClient {
  private cookies = new Map<string, string>()

  async request(method: string, path: string, body?: unknown) {
    const headers = new Headers({ origin: ORIGIN })
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const res = await app.request(`${ORIGIN}${path}`, {
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
