import { describe, expect, it } from 'vitest'
import { createFakeProvider, isFakeModel } from '../src'

describe('isFakeModel', () => {
  it('フェイクのプロバイダーが名乗るモデル名は、fake と判定される', () => {
    expect(isFakeModel(createFakeProvider('openai').model)).toBe(true)
    expect(isFakeModel(createFakeProvider('gemini').model)).toBe(true)
  })

  it('本物のモデル名やデモのモデル名は、fake と判定されない', () => {
    expect(isFakeModel('gpt-5.4')).toBe(false)
    expect(isFakeModel('gemini-3-flash')).toBe(false)
    expect(isFakeModel('demo-openai')).toBe(false)
    expect(isFakeModel('not-fake-openai')).toBe(false)
  })
})
