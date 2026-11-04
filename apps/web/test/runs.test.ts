import { describe, expect, it } from 'vitest'
import { TestClient } from './helpers'

async function setupBrand(samplesPerPrompt = 2) {
  const client = new TestClient()
  await client.signUp('dave')
  await client.createOrganization('Dave Inc')
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    competitors: [{ name: '競合A' }],
    prompts: ['おすすめの会計ソフトは？', '安い会計ソフトは？'],
    samplesPerPrompt,
  })
  return { client, brandId: json.brand.id as string }
}

describe('手動実行', () => {
  it('実行すると、質問 × AI × サンプル数 の回答が保存される', async () => {
    const { client, brandId } = await setupBrand(2)

    const started = await client.post(`/api/brands/${brandId}/runs`, {})
    expect(started.status).toBe(202)
    expect(started.json.run.trigger).toBe('manual')

    // テストでは実行が終わってからレスポンスが返る
    const list = await client.get(`/api/brands/${brandId}/runs`)
    expect(list.json.runs).toHaveLength(1)
    // 2 質問 × 2 AI × 2 回 = 8
    expect(list.json.runs[0]).toMatchObject({ status: 'succeeded', succeeded: 8, failed: 0 })

    const detail = await client.get(`/api/brands/${brandId}/runs/${started.json.run.id}`)
    expect(detail.status).toBe(200)
    expect(detail.json.run.responses).toHaveLength(8)
    expect(detail.json.run.responses[0].answerText).toContain('◯◯会計')
    expect(detail.json.run.responses[0].citations.length).toBeGreaterThan(0)
  })

  it('他の組織のブランドは実行できない（404）', async () => {
    const { brandId } = await setupBrand()
    const other = new TestClient()
    await other.signUp('eve')
    await other.createOrganization('Eve Inc')

    const res = await other.post(`/api/brands/${brandId}/runs`, {})
    expect(res.status).toBe(404)
    const runs = await other.get(`/api/brands/${brandId}/runs`)
    expect(runs.status).toBe(404)
  })

  it('他のブランドの run ID を指定しても見えない（404）', async () => {
    const a = await setupBrand(1)
    const started = await a.client.post(`/api/brands/${a.brandId}/runs`, {})

    // 同じ組織の別ブランドの URL に、さっきの run ID を付けてみる
    const { json } = await a.client.post('/api/brands', { name: '別ブランド', prompts: ['質問'] })
    const res = await a.client.get(`/api/brands/${json.brand.id}/runs/${started.json.run.id}`)
    expect(res.status).toBe(404)
  })
})

describe('ダッシュボードの数字', () => {
  it('実行したあとは、今日の言及率と競合とのシェアが出る', async () => {
    const { client, brandId } = await setupBrand(3)
    await client.post(`/api/brands/${brandId}/runs`, {})

    const res = await client.get(`/api/brands/${brandId}/metrics?days=7`)
    expect(res.status).toBe(200)
    const { metrics } = res.json
    expect(metrics.trend.all).toHaveLength(7)
    // 2 質問 × 2 AI × 3 回 = 12 件の回答が、今日の点に入る
    expect(metrics.latest.n).toBe(12)
    expect(metrics.latest.rate).toBeGreaterThanOrEqual(0)
    expect(metrics.latest.low).toBeLessThanOrEqual(metrics.latest.rate)
    expect(metrics.latest.high).toBeGreaterThanOrEqual(metrics.latest.rate)

    const names = metrics.shareOfVoice.map((e: { name: string }) => e.name)
    expect(names).toContain('◯◯会計')
    expect(metrics.topDomains.length).toBeGreaterThan(0)
  })

  it('日数の指定が範囲外なら 400', async () => {
    const { client, brandId } = await setupBrand(1)
    const res = await client.get(`/api/brands/${brandId}/metrics?days=365`)
    expect(res.json.error.code).toBe('VALIDATION_ERROR')
    expect(res.status).toBe(400)
  })
})
