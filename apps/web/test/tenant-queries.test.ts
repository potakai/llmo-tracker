import { describe, expect, it } from 'vitest'
import { getBrandMetrics } from '@/server/queries/metrics'
import { findPromptInBrand, listPromptResponses, updatePromptKind } from '@/server/queries/prompts'
import { getRunDetail, listRuns } from '@/server/queries/runs'
import { TestClient } from './helpers'

/**
 * 1 回計測したブランドを持つ組織と、それとは別の組織を作る。
 * クエリには、別の組織の ID と「持ち主の組織のブランド・質問・run の ID」を組み合わせて渡す
 */
async function setupTwoOrganizations() {
  const owner = new TestClient()
  await owner.signUp('paul')
  const ownerOrg = await owner.createOrganization('Paul Inc')
  const { json } = await owner.post('/api/brands', {
    name: '◯◯会計',
    competitors: [{ name: '競合A' }],
    prompts: ['おすすめの会計ソフトは？'],
    samplesPerPrompt: 1,
  })
  const started = await owner.post(`/api/brands/${json.brand.id}/runs`, {})

  const other = new TestClient()
  await other.signUp('quinn')
  const otherOrg = await other.createOrganization('Quinn Inc')

  return {
    ownerOrgId: ownerOrg.json.id as string,
    otherOrgId: otherOrg.json.id as string,
    brandId: json.brand.id as string,
    promptId: json.brand.prompts[0].id as string,
    runId: started.json.run.id as string,
  }
}

describe('クエリはテナントの境界（brand.organization_id）で絞る', () => {
  it('持ち主の組織の ID なら、計測の結果が返る', async () => {
    const ids = await setupTwoOrganizations()

    const metrics = await getBrandMetrics(ids.ownerOrgId, ids.brandId, 'fake', { days: 7 })
    expect(metrics.latest?.n).toBe(2)
    expect(await listRuns(ids.ownerOrgId, ids.brandId)).toHaveLength(1)
    expect(await getRunDetail(ids.ownerOrgId, ids.brandId, ids.runId)).toBeTruthy()
    expect(await findPromptInBrand(ids.ownerOrgId, ids.brandId, ids.promptId)).not.toBeNull()
    expect(await listPromptResponses(ids.ownerOrgId, ids.promptId, 'fake')).toHaveLength(2)
  })

  it('他の組織の ID を渡すと、ダッシュボードの数字は空になる', async () => {
    const ids = await setupTwoOrganizations()

    const metrics = await getBrandMetrics(ids.otherOrgId, ids.brandId, 'fake', { days: 7 })
    expect(metrics.latest?.n).toBe(0)
    expect(metrics.windowTotal).toBe(0)
    expect(metrics.shareOfVoice).toEqual([])
    expect(metrics.topDomains).toEqual([])
    expect(metrics.byPrompt).toEqual([])
    expect(metrics.byKind?.map((k) => k.n)).toEqual([0, 0])
    // 種類で絞り込んでも、他の組織の回答は入らない
    const filtered = await getBrandMetrics(ids.otherOrgId, ids.brandId, 'fake', {
      days: 7,
      kind: 'question',
    })
    expect(filtered.latest?.n).toBe(0)
  })

  it('他の組織の ID を渡すと、計測の一覧は空、詳細は見つからない', async () => {
    const ids = await setupTwoOrganizations()

    expect(await listRuns(ids.otherOrgId, ids.brandId)).toEqual([])
    expect(await getRunDetail(ids.otherOrgId, ids.brandId, ids.runId)).toBeUndefined()
  })

  it('他の組織の ID を渡すと、質問は見つからず、回答の一覧は空になる', async () => {
    const ids = await setupTwoOrganizations()

    expect(await findPromptInBrand(ids.otherOrgId, ids.brandId, ids.promptId)).toBeNull()
    expect(await listPromptResponses(ids.otherOrgId, ids.promptId, 'fake')).toEqual([])
  })

  it('他の組織の ID を渡すと、質問の種類は変わらない。持ち主の組織の ID なら変わる', async () => {
    const ids = await setupTwoOrganizations()

    expect(await updatePromptKind(ids.otherOrgId, ids.brandId, ids.promptId, 'keyword')).toBeNull()
    expect(await findPromptInBrand(ids.ownerOrgId, ids.brandId, ids.promptId)).toMatchObject({
      kind: 'question',
    })

    const updated = await updatePromptKind(ids.ownerOrgId, ids.brandId, ids.promptId, 'keyword')
    expect(updated?.kind).toBe('keyword')
  })
})
