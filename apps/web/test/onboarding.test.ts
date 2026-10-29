import { describe, expect, it } from 'vitest'
import { TestClient } from './helpers'

const validBrand = {
  name: '◯◯会計',
  domain: 'https://www.maru-kaikei.example.com/about',
  competitors: [{ name: '競合A' }, { name: '競合B', domain: 'competitor-b.example.com' }],
  prompts: ['中小企業向けのおすすめ会計ソフトは？', 'freee 以外の選択肢は？'],
}

describe('サインアップ → 組織作成 → ブランド登録', () => {
  it('一連の流れが通る', async () => {
    const alice = new TestClient()

    // 1. サインアップ
    const signUp = await alice.signUp('alice')
    expect(signUp.status).toBe(200)

    // 2. 組織を作る前は、ブランドの API は使えない
    const beforeOrg = await alice.get('/api/brands')
    expect(beforeOrg.status).toBe(400)
    expect(beforeOrg.json.error.code).toBe('NO_ACTIVE_ORGANIZATION')

    // 3. 組織を作る
    const org = await alice.createOrganization('Alice Inc')
    expect(org.status).toBe(200)

    // 4. ブランドを登録（競合と質問も一緒に）
    const created = await alice.post('/api/brands', validBrand)
    expect(created.status).toBe(201)
    const brand = created.json.brand
    expect(brand.organizationId).toBe(org.json.id)
    expect(brand.domain).toBe('maru-kaikei.example.com') // URL からホスト名だけにそろう
    expect(brand.samplesPerPrompt).toBe(5) // 初期値
    expect(brand.providers).toEqual(['openai', 'gemini'])
    expect(brand.competitors.map((c: { name: string }) => c.name)).toEqual(['競合A', '競合B'])
    expect(brand.prompts).toHaveLength(2)

    // 5. 一覧と詳細で取れる
    const list = await alice.get('/api/brands')
    expect(list.json.brands).toHaveLength(1)
    const detail = await alice.get(`/api/brands/${brand.id}`)
    expect(detail.status).toBe(200)
    expect(detail.json.brand.id).toBe(brand.id)
  })
})

describe('アクセス制御', () => {
  it('ログインしていなければ 401', async () => {
    const guest = new TestClient()
    const res = await guest.get('/api/brands')
    expect(res.status).toBe(401)
    expect(res.json.error.code).toBe('UNAUTHORIZED')
  })

  it('他の組織のブランドは見えない（404）', async () => {
    const alice = new TestClient()
    await alice.signUp('alice')
    await alice.createOrganization('Alice Inc')
    const { json } = await alice.post('/api/brands', validBrand)

    const bob = new TestClient()
    await bob.signUp('bob')
    await bob.createOrganization('Bob Inc')

    const detail = await bob.get(`/api/brands/${json.brand.id}`)
    expect(detail.status).toBe(404)
    const list = await bob.get('/api/brands')
    expect(list.json.brands).toHaveLength(0)
  })
})

describe('入力チェック', () => {
  async function loggedInWithOrg() {
    const client = new TestClient()
    await client.signUp('carol')
    await client.createOrganization('Carol Inc')
    return client
  }

  it('質問は10件まで', async () => {
    const client = await loggedInWithOrg()
    const prompts = Array.from({ length: 11 }, (_, i) => `質問${i}`)
    const res = await client.post('/api/brands', { ...validBrand, prompts })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('VALIDATION_ERROR')
    expect(res.json.error.issues[0].path).toEqual(['prompts'])
  })

  it('競合の名前の重複はエラー', async () => {
    const client = await loggedInWithOrg()
    const res = await client.post('/api/brands', {
      ...validBrand,
      competitors: [{ name: '競合A' }, { name: '競合a' }],
    })
    expect(res.status).toBe(400)
  })

  it('不正なドメインはエラー', async () => {
    const client = await loggedInWithOrg()
    const res = await client.post('/api/brands', { ...validBrand, domain: 'not a domain' })
    expect(res.status).toBe(400)
  })

  it('質問が0件ならエラーで、ブランドも作られない', async () => {
    const client = await loggedInWithOrg()
    const res = await client.post('/api/brands', { ...validBrand, prompts: [] })
    expect(res.status).toBe(400)
    const list = await client.get('/api/brands')
    expect(list.json.brands).toHaveLength(0)
  })

  it('ブランドIDが UUID でなければ 400', async () => {
    const client = await loggedInWithOrg()
    const res = await client.get('/api/brands/not-a-uuid')
    expect(res.status).toBe(400)
  })
})
