import { describe, expect, it } from 'vitest'
import { normalize } from '../src'
import { type GoldenCase, goldenSetSchema, loadGoldenSet } from '../src/eval/golden'

const MIN_CASES = 25

/** スキーマの検証に使う、正しい形の1件 */
const validCase = (): GoldenCase => ({
  id: 'sample',
  note: 'サンプル',
  input: {
    answerText: 'ソラハタ会計とクモツムギ会計がおすすめです',
    brand: { name: 'ソラハタ会計', aliases: [] },
    competitors: [{ id: 'kumotsumugi', name: 'クモツムギ会計', aliases: [] }],
  },
  expected: {
    brandMentioned: true,
    brandRank: 1,
    sentiment: 'positive',
    mentions: [
      { entityType: 'brand', competitorId: null, name: 'ソラハタ会計' },
      { entityType: 'competitor', competitorId: 'kumotsumugi', name: 'クモツムギ会計' },
    ],
  },
})

describe('ゴールデンセット（eval/golden.json）', () => {
  it('読み込むと、スキーマに合い、25件以上ある', async () => {
    const cases = await loadGoldenSet()
    expect(cases.length).toBeGreaterThanOrEqual(MIN_CASES)
  })

  it('id に重複がない', async () => {
    const ids = (await loadGoldenSet()).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('正解の competitorId は、すべてそのケースの input.competitors にある', async () => {
    for (const c of await loadGoldenSet()) {
      const ids = new Set(c.input.competitors.map((comp) => comp.id))
      for (const m of c.expected.mentions.filter((m) => m.entityType === 'competitor')) {
        expect(ids, `${c.id} の ${m.name}`).toContain(m.competitorId)
      }
    }
  })

  it('正解の言及の表記は、すべて回答文の中にある（全角半角・大文字小文字の違いは無視）', async () => {
    for (const c of await loadGoldenSet()) {
      for (const m of c.expected.mentions) {
        expect(normalize(c.input.answerText), `${c.id} の ${m.name}`).toContain(normalize(m.name))
      }
    }
  })
})

describe('ゴールデンセットのスキーマ', () => {
  it('正しい形なら通る', () => {
    expect(goldenSetSchema.safeParse([validCase()]).success).toBe(true)
  })

  it('id が重複していると、エラーになる', () => {
    expect(goldenSetSchema.safeParse([validCase(), validCase()]).success).toBe(false)
  })

  it('competitorId が input.competitors にないと、エラーになる', () => {
    const c = validCase()
    const broken = {
      ...c,
      expected: {
        ...c.expected,
        mentions: [
          c.expected.mentions[0]!,
          { entityType: 'competitor', competitorId: 'no-such-id', name: 'クモツムギ会計' },
        ],
      },
    }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })

  it('brandRank が mentions の中のブランドの位置と合わないと、エラーになる', () => {
    const c = validCase()
    const broken = { ...c, expected: { ...c.expected, brandRank: 2 } }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })

  it('brandMentioned が mentions と合わないと、エラーになる', () => {
    const c = validCase()
    const broken = { ...c, expected: { ...c.expected, brandMentioned: false } }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })

  it('ブランドが出てこないのに sentiment があると、エラーになる', () => {
    const c = validCase()
    const broken = {
      ...c,
      expected: {
        brandMentioned: false,
        brandRank: null,
        sentiment: 'positive',
        mentions: [c.expected.mentions[1]!],
      },
    }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })

  it('ブランドが出てくるのに sentiment が null だと、エラーになる', () => {
    const c = validCase()
    const broken = { ...c, expected: { ...c.expected, sentiment: null } }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })

  it('同じ会社が mentions に2回あると、エラーになる', () => {
    const c = validCase()
    const broken = {
      ...c,
      expected: { ...c.expected, mentions: [...c.expected.mentions, c.expected.mentions[1]!] },
    }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })

  it('brand や unknown に competitorId があると、エラーになる', () => {
    const c = validCase()
    const broken = {
      ...c,
      expected: {
        ...c.expected,
        mentions: [
          { entityType: 'unknown', competitorId: 'kumotsumugi', name: 'ミドリカエデ帳簿' },
          ...c.expected.mentions,
        ],
        brandRank: 2,
      },
    }
    expect(goldenSetSchema.safeParse([broken]).success).toBe(false)
  })
})
