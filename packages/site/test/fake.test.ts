import { describe, expect, it } from 'vitest'
import { createFakeSiteFetcher } from '../src/fake'
import { createSitePolicyWith } from '../src/policy'
import { SiteFetchError } from '../src/types'

describe('フェイクのサイト', () => {
  const fake = createFakeSiteFetcher({ registeredDomain: 'maru.example.com', brandName: '◯◯会計' })

  it('robots.txt・sitemap・ページを返し、ないページは 404 にする', async () => {
    expect((await fake.fetch('https://maru.example.com/robots.txt')).body).toContain('GPTBot')
    expect((await fake.fetch('https://maru.example.com/sitemap.xml')).body).toContain('<urlset')
    const top = await fake.fetch('https://www.maru.example.com/')
    expect(top).toMatchObject({ status: 200, contentType: expect.stringContaining('text/html') })
    expect(top.body).toContain('◯◯会計')
    expect((await fake.fetch('https://maru.example.com/llms.txt')).status).toBe(404)
  })

  it('本物と同じく、登録したドメインの外は読まない', async () => {
    await expect(fake.fetch('https://evil.example/')).rejects.toBeInstanceOf(SiteFetchError)
    await expect(fake.fetch('http://127.0.0.1/')).rejects.toMatchObject({ reason: 'outside_site' })
  })

  it('版ごとに中身が変わる（前回からの変化を見せるため）', async () => {
    const old = createFakeSiteFetcher({
      registeredDomain: 'maru.example.com',
      brandName: '◯◯会計',
      revision: 0,
    })
    expect((await old.fetch('https://maru.example.com/robots.txt')).body).toContain('PerplexityBot')
    expect((await fake.fetch('https://maru.example.com/robots.txt')).body).not.toContain(
      'PerplexityBot',
    )
  })
})

describe('本物のサイトを読むかのポリシー', () => {
  const build = () => createFakeSiteFetcher({ registeredDomain: 'a.example', brandName: 'A' })

  it('SITE_MODE=live で、LIVE_ORGANIZATION_IDS にある組織だけ live', () => {
    const policy = createSitePolicyWith(
      { SITE_MODE: 'live', LIVE_ORGANIZATION_IDS: 'org-1' },
      build,
    )
    expect(policy.modeFor('org-1')).toBe('live')
    expect(policy.modeFor('org-2')).toBe('fake')
  })

  it('SITE_MODE が live でなければ、許可の一覧にあってもフェイク（AI の LLM_MODE とは別）', () => {
    const env = { LLM_MODE: 'live', LIVE_ORGANIZATION_IDS: '*' }
    expect(createSitePolicyWith(env, build).modeFor('org-1')).toBe('fake')
  })
})
