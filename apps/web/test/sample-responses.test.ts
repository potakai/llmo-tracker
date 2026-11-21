import {
  type AnswerProvider,
  createFakeProvider,
  createRuleBasedExtractor,
  type LlmMode,
  type ProviderId,
} from '@llmo/llm'
import { executeRun } from '@llmo/runner'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { sampleRunNotice } from '@/lib/sample-run'
import { createApp } from '@/server/app'
import { listPromptResponses } from '@/server/queries/prompts'
import { TestClient } from './helpers'

const REAL_DOMAIN = 'real-review.jp'

/** 本物の AI の代わり：回答はフェイクと同じだが、本物のモデル名と本物らしい出典を返す（API は叩かない） */
function createRealLookingProvider(id: ProviderId): AnswerProvider {
  const fake = createFakeProvider(id)
  const model = `real-${id}-model`
  return {
    id,
    model,
    async ask(input) {
      const result = await fake.ask(input)
      return {
        ...result,
        model,
        sources: [{ url: `https://${REAL_DOMAIN}/${id}`, title: '比較記事' }],
      }
    },
  }
}

type RunKind = 'fake' | 'real' | 'mixed'

/** 計測に使う AI。mixed は ChatGPT だけ本物（途中で live に切り替わった計測の代わり） */
function providersFor(kind: RunKind) {
  return {
    openai: kind === 'fake' ? createFakeProvider('openai') : createRealLookingProvider('openai'),
    gemini: kind === 'real' ? createRealLookingProvider('gemini') : createFakeProvider('gemini'),
  }
}

/**
 * fake の計測を 1 回、本物の計測を 1 回した組織を作る（live にする前にサンプルで計測した状態）。
 * 2 質問 × 2 AI × 1 回 = 4 件ずつ。runOnce で、あとから計測を足せる
 */
async function setupMixedBrand(mode: LlmMode) {
  let next: RunKind = 'fake'
  const app = createApp({
    dispatchRun: async (runId) => {
      await executeRun(
        { db, providers: providersFor(next), extractor: createRuleBasedExtractor() },
        runId,
      )
    },
    llmModeFor: () => mode,
  })
  const client = new TestClient(app)
  await client.signUp('olivia')
  await client.createOrganization('Olivia Inc')
  const { json } = await client.post('/api/brands', {
    name: '◯◯会計',
    competitors: [{ name: '競合A' }],
    prompts: ['おすすめの会計ソフトは？', '安い会計ソフトは？'],
    samplesPerPrompt: 1,
  })
  const brandId = json.brand.id as string
  const organizationId = json.brand.organizationId as string
  const promptId = json.brand.prompts[0].id as string

  const runOnce = async (kind: RunKind) => {
    next = kind
    const started = await client.post(`/api/brands/${brandId}/runs`, {})
    return started.json.run.id as string
  }
  const fakeRunId = await runOnce('fake')
  const realRunId = await runOnce('real')
  return { client, brandId, organizationId, promptId, fakeRunId, realRunId, runOnce }
}

describe('live の組織', () => {
  it('fake と本物の回答が混ざっていても、集計には本物の回答だけが使われる', async () => {
    const { client, brandId } = await setupMixedBrand('live')

    const { metrics } = (await client.get(`/api/brands/${brandId}/metrics?days=7`)).json
    expect(metrics.latest.n).toBe(4)
    expect(metrics.trend.openai.at(-1).n).toBe(2)
    expect(metrics.windowTotal).toBe(4)
    expect(metrics.topDomains.map((d: { domain: string }) => d.domain)).toEqual([REAL_DOMAIN])
    for (const p of metrics.byPrompt) expect(p.n).toBe(2)
    for (const e of metrics.shareOfVoice) expect(e.responses).toBeLessThanOrEqual(4)
  })

  it('質問の回答の一覧には、本物の回答だけが出る', async () => {
    const { organizationId, promptId } = await setupMixedBrand('live')

    const responses = await listPromptResponses(organizationId, promptId, 'live')
    expect(responses).toHaveLength(2)
    expect(responses.every((r) => !r.model.startsWith('fake-'))).toBe(true)
  })

  it('計測の履歴には fake の計測も残り、サンプルの印が付く', async () => {
    const { client, brandId, fakeRunId, realRunId } = await setupMixedBrand('live')

    const { runs } = (await client.get(`/api/brands/${brandId}/runs`)).json
    const byId = new Map(runs.map((r: { id: string }) => [r.id, r]))
    expect(byId.get(fakeRunId)).toMatchObject({ isSample: true, succeeded: 4 })
    expect(byId.get(realRunId)).toMatchObject({ isSample: false, succeeded: 4 })

    // 計測そのものは消さない：fake の計測の詳細も見られる
    const detail = await client.get(`/api/brands/${brandId}/runs/${fakeRunId}`)
    expect(detail.status).toBe(200)
    expect(detail.json.run.responses).toHaveLength(4)
  })
})

describe('fake の組織', () => {
  it('fake の回答も今までどおり集計される', async () => {
    const { client, brandId, organizationId, promptId } = await setupMixedBrand('fake')

    const { metrics } = (await client.get(`/api/brands/${brandId}/metrics?days=7`)).json
    expect(metrics.latest.n).toBe(8)
    expect(metrics.topDomains.map((d: { domain: string }) => d.domain)).toContain('example.com')

    const responses = await listPromptResponses(organizationId, promptId, 'fake')
    expect(responses).toHaveLength(4)
  })
})

describe('計測の詳細の注記', () => {
  it('全部がサンプルの計測には、サンプルの計測だという注記が出る', async () => {
    const { client, brandId, fakeRunId } = await setupMixedBrand('live')

    const { run } = (await client.get(`/api/brands/${brandId}/runs/${fakeRunId}`)).json
    const models = run.responses.map((r: { model: string }) => r.model)
    expect(sampleRunNotice(models, 'live')).toEqual({ kind: 'all' })
    // fake の組織（デモ以外）でも、サンプルの計測だということは伝える
    expect(sampleRunNotice(models, 'fake')).toEqual({ kind: 'all' })
  })

  it('サンプルと本物が混ざった計測では、live の組織ならサンプルの件数が出る', async () => {
    const { client, brandId, runOnce } = await setupMixedBrand('live')
    const mixedRunId = await runOnce('mixed')

    const { run } = (await client.get(`/api/brands/${brandId}/runs/${mixedRunId}`)).json
    const models = run.responses.map((r: { model: string }) => r.model)
    // 2 質問 × Gemini（フェイク）× 1 回 = 2 件
    expect(sampleRunNotice(models, 'live')).toEqual({ kind: 'mixed', sampleCount: 2 })

    // 混ざった計測の本物の分は集計に入り、サンプルの分は入らない（4 + 2 件）
    const { metrics } = (await client.get(`/api/brands/${brandId}/metrics?days=7`)).json
    expect(metrics.latest.n).toBe(6)
  })

  it('本物だけの計測と、fake の組織の混ざった計測には、注記が出ない', async () => {
    expect(sampleRunNotice(['real-openai-model', 'real-gemini-model'], 'live')).toBeNull()
    // fake の組織では何も集計から外していないので「外しています」とは言わない
    expect(sampleRunNotice(['real-openai-model', 'fake-gemini'], 'fake')).toBeNull()
    expect(sampleRunNotice([], 'live')).toBeNull()
  })
})
