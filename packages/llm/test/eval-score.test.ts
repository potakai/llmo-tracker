import { describe, expect, it } from 'vitest'
import type { ExtractedMention } from '../src'
import type { ExpectedExtraction } from '../src/eval/golden'
import { type ActualExtraction, aggregateScores, scoreCase, scoreCases } from '../src/eval/score'

const brand = (name = 'ソラ会計') => ({ entityType: 'brand' as const, competitorId: null, name })
const competitor = (competitorId: string, name = competitorId) => ({
  entityType: 'competitor' as const,
  competitorId,
  name,
})
const unknown = (name: string) => ({ entityType: 'unknown' as const, competitorId: null, name })

/** 正解：クモノス会計 → ソラ会計 → ナミマ経理 */
const expected: ExpectedExtraction = {
  brandMentioned: true,
  brandRank: 2,
  sentiment: 'positive',
  mentions: [competitor('kumonos'), brand(), competitor('namima')],
}

/** 抽出結果を作る。mentions の並びから rank を振る */
function actual(
  mentions: Omit<ExtractedMention, 'rank'>[],
  sentiment: ActualExtraction['sentiment'] = 'positive',
): ActualExtraction {
  const ranked = mentions.map((m, i) => ({ ...m, rank: i + 1 }))
  const brandMention = ranked.find((m) => m.entityType === 'brand')
  return {
    brandMentioned: brandMention !== undefined,
    brandRank: brandMention?.rank ?? null,
    sentiment: brandMention ? sentiment : null,
    mentions: ranked,
  }
}

describe('ケースごとの判定', () => {
  it('全問正解すると、すべての判定が正解になり、ケースも正解になる', () => {
    // Act
    const score = scoreCase(
      expected,
      actual([competitor('kumonos'), brand(), competitor('namima')]),
    )

    // Assert
    expect(score).toMatchObject({
      brandMentioned: true,
      brandRank: true,
      sentiment: true,
      order: true,
      passed: true,
    })
    expect(score.registered).toMatchObject({
      truePositives: 3,
      falsePositives: 0,
      falseNegatives: 0,
    })
  })

  it('登録済みの会社は competitorId で照合するので、表記が違っても一致とみなす', () => {
    const score = scoreCase(
      expected,
      actual([competitor('kumonos', 'KUMONOS'), brand('Sora Kaikei'), competitor('namima')]),
    )
    expect(score.passed).toBe(true)
  })

  it('取りこぼすと、取りこぼした会社が missing に入り、ケースは不正解になる', () => {
    const score = scoreCase(expected, actual([competitor('kumonos'), brand()]))
    expect(score.registered).toMatchObject({
      truePositives: 2,
      falsePositives: 0,
      falseNegatives: 1,
      missing: ['competitor:namima'],
      extra: [],
    })
    expect(score.passed).toBe(false)
  })

  it('余計なものを拾うと、拾った会社が extra に入り、ケースは不正解になる', () => {
    const score = scoreCase(
      expected,
      actual([competitor('kumonos'), brand(), competitor('namima'), competitor('hoshizora')]),
    )
    expect(score.registered).toMatchObject({
      truePositives: 3,
      falsePositives: 1,
      falseNegatives: 0,
      extra: ['competitor:hoshizora'],
    })
    expect(score.passed).toBe(false)
  })

  it('順序が違うと、順序の判定とブランドの順位が不正解になる', () => {
    const score = scoreCase(
      expected,
      actual([brand(), competitor('kumonos'), competitor('namima')]),
    )
    expect(score).toMatchObject({ order: false, brandRank: false, brandMentioned: true })
    expect(score.registered.falseNegatives + score.registered.falsePositives).toBe(0)
  })

  it('順序は両方に出てくる会社だけで比べるので、取りこぼしがあっても並びが合っていれば正解', () => {
    const score = scoreCase(expected, actual([competitor('kumonos'), competitor('namima')]))
    expect(score.order).toBe(true)
  })

  it('両方に出てくる登録済みの会社が1つ以下なら、順序は対象外（null）になる', () => {
    const score = scoreCase(expected, actual([competitor('namima')]))
    expect(score.order).toBeNull()
  })

  it('ブランドの順位が null 同士なら、一致として数える', () => {
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [competitor('kumonos')],
    }
    const score = scoreCase(notMentioned, actual([competitor('kumonos')]))
    expect(score).toMatchObject({ brandMentioned: true, brandRank: true, passed: true })
  })

  it('正解でブランドが出てこないケースは、感情の判定の対象外（null）になる', () => {
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [],
    }
    const score = scoreCase(notMentioned, actual([brand()], 'negative'))
    expect(score.sentiment).toBeNull()
    expect(score.brandMentioned).toBe(false)
  })

  it('感情が違うと、感情の判定が不正解になる（抽出器が null を返した場合も）', () => {
    const mentions = [competitor('kumonos'), brand(), competitor('namima')]
    expect(scoreCase(expected, actual(mentions, 'neutral')).sentiment).toBe(false)
    expect(scoreCase(expected, actual(mentions, null)).sentiment).toBe(false)
  })

  it('未登録の会社は normalize した名前で照合し、全角半角や大文字小文字の違いは一致とみなす', () => {
    const withUnknown: ExpectedExtraction = {
      ...expected,
      mentions: [unknown('Pocket Books'), ...expected.mentions],
      brandRank: 3,
    }
    const score = scoreCase(
      withUnknown,
      actual([
        unknown('ＰＯＣＫＥＴ ＢＯＯＫＳ'),
        competitor('kumonos'),
        brand(),
        competitor('namima'),
        unknown('ミドリ帳簿'),
      ]),
    )
    expect(score.unknown).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
      extra: ['ミドリ帳簿'],
    })
  })

  it('未登録の会社の取りこぼしは参考値なので、それだけではケースは不正解にならない', () => {
    const withUnknown: ExpectedExtraction = {
      ...expected,
      mentions: [...expected.mentions, unknown('ミドリ帳簿')],
    }
    const score = scoreCase(
      withUnknown,
      actual([competitor('kumonos'), brand(), competitor('namima')]),
    )
    expect(score.unknown.falseNegatives).toBe(1)
    expect(score.passed).toBe(true)
  })

  it('抽出に失敗した（結果が null）ケースは、すべての判定を不正解として数える', () => {
    const score = scoreCase(expected, null)
    expect(score).toMatchObject({
      brandMentioned: false,
      brandRank: false,
      sentiment: false,
      order: false,
      passed: false,
    })
    expect(score.registered).toMatchObject({ truePositives: 0, falseNegatives: 3 })
  })
})

describe('全ケースの採点', () => {
  const mentions = [competitor('kumonos'), brand(), competitor('namima')]

  it('抽出器が sentiment を一度も返さなければ、各ケースの感情は対象外（null）になり、感情以外が合っていれば正解になる', () => {
    // Act
    const scores = scoreCases([
      { expected, actual: actual(mentions, null) },
      { expected, actual: actual([brand()], null) },
    ])

    // Assert
    expect(scores.map((s) => s.sentiment)).toEqual([null, null])
    expect(scores.map((s) => s.passed)).toEqual([true, false])
    expect(aggregateScores(scores)).toMatchObject({ passedCount: 1, sentimentAccuracy: null })
  })

  it('1件でも sentiment を返していれば、感情が外れたケースは不正解のまま', () => {
    const scores = scoreCases([
      { expected, actual: actual(mentions, 'positive') },
      { expected, actual: actual(mentions, null) },
    ])
    expect(scores.map((s) => s.sentiment)).toEqual([true, false])
    expect(scores.map((s) => s.passed)).toEqual([true, false])
  })

  it('抽出に失敗したケースは、感情を外しても不正解のまま', () => {
    const scores = scoreCases([{ expected, actual: null }])
    expect(scores[0]).toMatchObject({ sentiment: null, passed: false })
  })
})

describe('全体の集計', () => {
  it('各指標の割合と、登録済みの会社の適合率・再現率・F1 を計算する', () => {
    // Arrange：1件は全問正解、1件は取りこぼし＋余計なもの＋感情違い
    const perfect = scoreCase(
      expected,
      actual([competitor('kumonos'), brand(), competitor('namima')]),
    )
    const partial = scoreCase(
      expected,
      actual([competitor('kumonos'), brand(), competitor('hoshizora')], 'negative'),
    )

    // Act
    const metrics = aggregateScores([perfect, partial])

    // Assert
    expect(metrics.caseCount).toBe(2)
    expect(metrics.passedCount).toBe(1)
    expect(metrics.brandMentionAccuracy).toEqual({ correct: 2, total: 2, rate: 1 })
    expect(metrics.brandRankAccuracy).toEqual({ correct: 2, total: 2, rate: 1 })
    expect(metrics.sentimentAccuracy).toEqual({ correct: 1, total: 2, rate: 0.5 })
    // TP=3+2, FP=0+1, FN=0+1
    expect(metrics.registered.precision).toBeCloseTo(5 / 6)
    expect(metrics.registered.recall).toBeCloseTo(5 / 6)
    expect(metrics.registered.f1).toBeCloseTo(5 / 6)
    // partial は共通の会社が kumonos と brand の2つで、並びは合っている
    expect(metrics.orderAccuracy).toEqual({ correct: 2, total: 2, rate: 1 })
  })

  it('対象が0件の指標や、分母が0の適合率は null になる', () => {
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [],
    }
    const metrics = aggregateScores([scoreCase(notMentioned, actual([]))])
    expect(metrics.sentimentAccuracy).toBeNull()
    expect(metrics.orderAccuracy.rate).toBeNull()
    expect(metrics.registered).toMatchObject({ precision: null, recall: null, f1: null })
    expect(metrics.unknown).toMatchObject({ precision: null, recall: null })
  })

  it('抽出器が sentiment を一度も返さなければ（全件 null）、感情の正解率は 0% ではなく null（対象外）になる', () => {
    // Arrange：ルールベースのように、ブランドを見つけても感情は返さない
    const mentions = [competitor('kumonos'), brand(), competitor('namima')]
    const scores = [scoreCase(expected, actual(mentions, null)), scoreCase(expected, null)]

    // Act
    const metrics = aggregateScores(scores)

    // Assert
    expect(metrics.sentimentAccuracy).toBeNull()
  })

  it('1件でも sentiment を返していれば、返さなかったケースは感情の不正解として数える', () => {
    const mentions = [competitor('kumonos'), brand(), competitor('namima')]
    const metrics = aggregateScores([
      scoreCase(expected, actual(mentions, 'positive')),
      scoreCase(expected, actual(mentions, null)),
    ])
    expect(metrics.sentimentAccuracy).toEqual({ correct: 1, total: 2, rate: 0.5 })
  })

  it('1件もなければ、件数は0で割合はすべて null になる', () => {
    const metrics = aggregateScores([])
    expect(metrics.caseCount).toBe(0)
    expect(metrics.brandMentionAccuracy.rate).toBeNull()
  })
})
