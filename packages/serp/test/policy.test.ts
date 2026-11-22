import { describe, expect, it } from 'vitest'
import { createFakeSerpProvider, createSerpPolicy, createSerpPolicyWith } from '../src'

const ORG_A = '01900000-0000-7000-8000-00000000000a'
const ORG_B = '01900000-0000-7000-8000-00000000000b'

describe('createSerpPolicy', () => {
  it('SERP_MODE=live で、許可の一覧（LIVE_ORGANIZATION_IDS）にある組織だけ live', () => {
    const policy = createSerpPolicy({ SERP_MODE: 'live', LIVE_ORGANIZATION_IDS: ORG_A })
    expect(policy.modeFor(ORG_A)).toBe('live')
    expect(policy.modeFor(ORG_B)).toBe('fake')
  })

  it('SERP_MODE が live でなければ、LLM_MODE=live で一覧にあっても fake（AI とは別に止められる）', () => {
    const policy = createSerpPolicy({ LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: ORG_A })
    expect(policy.modeFor(ORG_A)).toBe('fake')
  })

  it('一覧が空なら、SERP_MODE=live でもすべて fake', () => {
    expect(createSerpPolicy({ SERP_MODE: 'live' }).modeFor(ORG_A)).toBe('fake')
  })

  it('live のプロバイダーは使うときに作る。認証情報がなければ作れない（fake は作れる）', () => {
    const policy = createSerpPolicy({ SERP_MODE: 'live', LIVE_ORGANIZATION_IDS: ORG_A })
    expect(policy.providerFor('fake').mode).toBe('fake')
    expect(() => policy.providerFor('live')).toThrow(/DATAFORSEO_LOGIN/)
  })

  it('live / fake それぞれ 1 回だけ作る', () => {
    const built: string[] = []
    const policy = createSerpPolicyWith(
      { SERP_MODE: 'live', LIVE_ORGANIZATION_IDS: '*' },
      (mode) => {
        built.push(mode)
        return { ...createFakeSerpProvider(), mode }
      },
    )
    policy.providerFor('live')
    policy.providerFor('fake')
    policy.providerFor('live')
    expect(built).toEqual(['live', 'fake'])
  })
})
