import { describe, expect, it } from 'vitest'
import { createLlmPolicy, createLlmPolicyWith, createRuleBasedExtractor, liveModeFor } from '../src'

const ORG_A = '01900000-0000-7000-8000-00000000000a'
const ORG_B = '01900000-0000-7000-8000-00000000000b'

describe('liveModeFor', () => {
  it('LLM_MODE=live でも、一覧にない組織は fake', () => {
    const modeFor = liveModeFor({ LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: ` ${ORG_A} ,` })
    expect(modeFor(ORG_A)).toBe('live')
    expect(modeFor(ORG_B)).toBe('fake')
  })

  it('一覧が空なら、LLM_MODE=live でもすべて fake（設定し忘れても課金されない）', () => {
    expect(liveModeFor({ LLM_MODE: 'live' })(ORG_A)).toBe('fake')
    expect(liveModeFor({ LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: '' })(ORG_A)).toBe('fake')
  })

  it('LLM_MODE が live でなければ、一覧にあっても fake', () => {
    expect(liveModeFor({ LIVE_ORGANIZATION_IDS: ORG_A })(ORG_A)).toBe('fake')
    expect(liveModeFor({ LLM_MODE: 'fake', LIVE_ORGANIZATION_IDS: '*' })(ORG_A)).toBe('fake')
  })

  it('* ならすべての組織が live（手元で試すとき用）', () => {
    expect(liveModeFor({ LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: '*' })(ORG_B)).toBe('live')
  })
})

describe('createLlmPolicyWith', () => {
  it('組織に合った AI を返し、live / fake それぞれ 1 回だけ作る', () => {
    const built: string[] = []
    const policy = createLlmPolicyWith(
      { LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: ORG_A },
      (mode) => {
        built.push(mode)
        return { providers: mode, extractor: createRuleBasedExtractor() }
      },
    )

    expect(policy.llmFor(ORG_A)).toMatchObject({ mode: 'live', providers: 'live' })
    expect(policy.llmFor(ORG_B)).toMatchObject({ mode: 'fake', providers: 'fake' })
    policy.llmFor(ORG_A)
    policy.llmFor(ORG_B)
    expect(built).toEqual(['live', 'fake'])
  })

  it('fake の組織しか使わなければ、本物の AI は作らない（API キーがなくても動く）', () => {
    const policy = createLlmPolicy({ LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: ORG_A })
    // API キーがないので、live を作ろうとすると例外になる
    expect(() => policy.llmFor(ORG_A)).toThrow(/API_KEY/)
    const fake = policy.llmFor(ORG_B)
    expect(fake.mode).toBe('fake')
    expect(fake.providers.openai.model).toMatch(/fake/)
  })
})
