import { describe, expect, it } from 'vitest'
import type { ExtractedMention } from '../src'
import type { ExpectedExtraction } from '../src/eval/golden'
import {
  type ActualExtraction,
  aggregateScores,
  type CaseScore,
  type ScoreOptions,
  scoreCase,
  scoreCases,
} from '../src/eval/score'

const brand = (name = 'ソラハタ会計') => ({
  entityType: 'brand' as const,
  competitorId: null,
  name,
})
const competitor = (competitorId: string, name = competitorId) => ({
  entityType: 'competitor' as const,
  competitorId,
  name,
})
const unknown = (name: string) => ({ entityType: 'unknown' as const, competitorId: null, name })

/** 正解：クモツムギ会計 → ソラハタ会計 → ナミヨセ経理 */
const expected: ExpectedExtraction = {
  brandMentioned: true,
  brandRank: 2,
  sentiment: 'positive',
  mentions: [competitor('kumotsumugi'), brand(), competitor('namiyose')],
}

/** 感情も採点する（LLM の抽出器と同じ扱い） */
const WITH_SENTIMENT: ScoreOptions = { scoreSentiment: true }
/** 感情は採点しない（ルールベースと同じ扱い） */
const WITHOUT_SENTIMENT: ScoreOptions = { scoreSentiment: false }

const scored = (e: ExpectedExtraction, a: ActualExtraction | null): CaseScore =>
  scoreCase(e, a, WITH_SENTIMENT)

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
    const score = scored(
      expected,
      actual([competitor('kumotsumugi'), brand(), competitor('namiyose')]),
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
    const score = scored(
      expected,
      actual([
        competitor('kumotsumugi', 'KUMOTSUMUGI'),
        brand('Sorahata Kaikei'),
        competitor('namiyose'),
      ]),
    )
    expect(score.passed).toBe(true)
  })

  it('取りこぼすと、取りこぼした会社が missing に入り、ケースは不正解になる', () => {
    const score = scored(expected, actual([competitor('kumotsumugi'), brand()]))
    expect(score.registered).toMatchObject({
      truePositives: 2,
      falsePositives: 0,
      falseNegatives: 1,
      missing: ['competitor:namiyose'],
      extra: [],
    })
    expect(score.passed).toBe(false)
  })

  it('余計なものを拾うと、拾った会社が extra に入り、ケースは不正解になる', () => {
    const score = scored(
      expected,
      actual([
        competitor('kumotsumugi'),
        brand(),
        competitor('namiyose'),
        competitor('hoshitsugumi'),
      ]),
    )
    expect(score.registered).toMatchObject({
      truePositives: 3,
      falsePositives: 1,
      falseNegatives: 0,
      extra: ['competitor:hoshitsugumi'],
    })
    expect(score.passed).toBe(false)
  })

  it('順序が違うと、順序の判定とブランドの順位が不正解になる', () => {
    const score = scored(
      expected,
      actual([brand(), competitor('kumotsumugi'), competitor('namiyose')]),
    )
    expect(score).toMatchObject({ order: false, brandRank: false, brandMentioned: true })
    expect(score.registered.falseNegatives + score.registered.falsePositives).toBe(0)
  })

  it('順序は両方に出てくる会社だけで比べるので、取りこぼしがあっても並びが合っていれば正解', () => {
    const score = scored(expected, actual([competitor('kumotsumugi'), competitor('namiyose')]))
    expect(score.order).toBe(true)
  })

  it('両方に出てくる登録済みの会社が1つ以下なら、順序は対象外（null）になる', () => {
    const score = scored(expected, actual([competitor('namiyose')]))
    expect(score.order).toBeNull()
  })

  it('ブランドの順位が null 同士なら、一致として数える', () => {
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [competitor('kumotsumugi')],
    }
    const score = scored(notMentioned, actual([competitor('kumotsumugi')]))
    expect(score).toMatchObject({ brandMentioned: true, brandRank: true, passed: true })
  })

  it('正解でブランドが出てこないケースは、感情の判定の対象外（null）になる', () => {
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [],
    }
    const score = scored(notMentioned, actual([brand()], 'negative'))
    expect(score.sentiment).toBeNull()
    expect(score.brandMentioned).toBe(false)
  })

  it('感情が違うと、感情の判定が不正解になる（抽出器が null を返した場合も）', () => {
    const mentions = [competitor('kumotsumugi'), brand(), competitor('namiyose')]
    expect(scored(expected, actual(mentions, 'neutral')).sentiment).toBe(false)
    expect(scored(expected, actual(mentions, null)).sentiment).toBe(false)
  })

  it('未登録の会社は normalize した名前で照合し、全角半角や大文字小文字の違いは一致とみなす', () => {
    const withUnknown: ExpectedExtraction = {
      ...expected,
      mentions: [unknown('Pocket Books'), ...expected.mentions],
      brandRank: 3,
    }
    const score = scored(
      withUnknown,
      actual([
        unknown('ＰＯＣＫＥＴ ＢＯＯＫＳ'),
        competitor('kumotsumugi'),
        brand(),
        competitor('namiyose'),
        unknown('ミドリカエデ帳簿'),
      ]),
    )
    expect(score.unknown).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
      extra: ['ミドリカエデ帳簿'],
    })
  })

  it('未登録の会社の取りこぼしは参考値なので、それだけではケースは不正解にならない', () => {
    const withUnknown: ExpectedExtraction = {
      ...expected,
      mentions: [...expected.mentions, unknown('ミドリカエデ帳簿')],
    }
    const score = scored(
      withUnknown,
      actual([competitor('kumotsumugi'), brand(), competitor('namiyose')]),
    )
    expect(score.unknown.falseNegatives).toBe(1)
    expect(score.passed).toBe(true)
  })

  it('抽出に失敗した（結果が null）ケースは、すべての判定を不正解として数える', () => {
    const score = scored(expected, null)
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

describe('感情を採点するか（抽出器の仕様で決める）', () => {
  const mentions = [competitor('kumotsumugi'), brand(), competitor('namiyose')]

  it('採点しない抽出器なら、感情を返していても各ケースの感情は対象外（null）になり、感情以外が合っていれば正解になる', () => {
    // Act
    const scores = scoreCases(
      [
        { expected, actual: actual(mentions, 'negative') },
        { expected, actual: actual([brand()], null) },
      ],
      WITHOUT_SENTIMENT,
    )

    // Assert
    expect(scores.map((s) => s.sentiment)).toEqual([null, null])
    expect(scores.map((s) => s.passed)).toEqual([true, false])
  })

  it('採点しない抽出器なら、感情の正解率は 0% ではなく null（対象外）になる', () => {
    const scores = scoreCases([{ expected, actual: actual(mentions, null) }], WITHOUT_SENTIMENT)
    const metrics = aggregateScores(scores, WITHOUT_SENTIMENT)
    expect(metrics).toMatchObject({
      sentimentScored: false,
      sentimentAccuracy: null,
      passedCount: 1,
    })
  })

  it('採点する抽出器なら、全件 null を返しても、正解でブランドが言及されているケースを分母にして不正解として数える', () => {
    // Arrange：LLM が感情を1件も返さなかった（null）＋抽出に失敗した
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [competitor('kumotsumugi')],
    }
    const scores = scoreCases(
      [
        { expected, actual: actual(mentions, null) },
        { expected, actual: null },
        { expected: notMentioned, actual: actual([competitor('kumotsumugi')]) },
      ],
      WITH_SENTIMENT,
    )

    // Act
    const metrics = aggregateScores(scores, WITH_SENTIMENT)

    // Assert：分母は正解でブランドが言及されている2件。どちらも不正解
    expect(metrics.sentimentScored).toBe(true)
    expect(metrics.sentimentAccuracy).toEqual({ correct: 0, total: 2, rate: 0 })
    expect(scores.map((s) => s.passed)).toEqual([false, false, true])
  })

  it('採点する抽出器なら、感情が合ったケースだけを正解として数える', () => {
    const scores = scoreCases(
      [
        { expected, actual: actual(mentions, 'positive') },
        { expected, actual: actual(mentions, 'neutral') },
      ],
      WITH_SENTIMENT,
    )
    expect(scores.map((s) => s.sentiment)).toEqual([true, false])
    expect(aggregateScores(scores, WITH_SENTIMENT).sentimentAccuracy).toEqual({
      correct: 1,
      total: 2,
      rate: 0.5,
    })
  })

  it('抽出に失敗したケースは、感情を採点しなくても不正解のまま', () => {
    const scores = scoreCases([{ expected, actual: null }], WITHOUT_SENTIMENT)
    expect(scores[0]).toMatchObject({ sentiment: null, passed: false })
  })
})

describe('全体の集計', () => {
  it('各指標の割合と、登録済みの会社の適合率・再現率・F1 を計算する', () => {
    // Arrange：1件は全問正解、1件は取りこぼし＋余計なもの＋感情違い
    const perfect = scored(
      expected,
      actual([competitor('kumotsumugi'), brand(), competitor('namiyose')]),
    )
    const partial = scored(
      expected,
      actual([competitor('kumotsumugi'), brand(), competitor('hoshitsugumi')], 'negative'),
    )

    // Act
    const metrics = aggregateScores([perfect, partial], WITH_SENTIMENT)

    // Assert
    expect(metrics.caseCount).toBe(2)
    expect(metrics.passedCount).toBe(1)
    expect(metrics.brandMentionAccuracy).toEqual({ correct: 2, total: 2, rate: 1 })
    expect(metrics.brandRankAccuracy).toEqual({ correct: 2, total: 2, rate: 1 })
    expect(metrics.sentimentAccuracy).toEqual({ correct: 1, total: 2, rate: 0.5 })
    // TP=3+2, FP=0+1, FN=0+1。F1 = 2TP / (2TP + FP + FN) = 10 / 12
    expect(metrics.registered.precision).toBeCloseTo(5 / 6)
    expect(metrics.registered.recall).toBeCloseTo(5 / 6)
    expect(metrics.registered.f1).toBeCloseTo(10 / 12)
    // partial は共通の会社が kumotsumugi と brand の2つで、並びは合っている
    expect(metrics.orderAccuracy).toEqual({ correct: 2, total: 2, rate: 1 })
  })

  it('1つも当たらなければ（TP=0, FP=1, FN=3）、F1 は null ではなく 0% になる', () => {
    // Arrange：正解は3社、抽出結果は正解にない1社だけ
    const score = scored(expected, actual([competitor('hoshitsugumi')]))

    // Act
    const metrics = aggregateScores([score], WITH_SENTIMENT)

    // Assert
    expect(metrics.registered).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 3,
      precision: 0,
      recall: 0,
      f1: 0,
    })
  })

  it('対象が0件の指標や、分母が0の適合率・F1 は null になる', () => {
    const notMentioned: ExpectedExtraction = {
      brandMentioned: false,
      brandRank: null,
      sentiment: null,
      mentions: [],
    }
    const metrics = aggregateScores([scored(notMentioned, actual([]))], WITH_SENTIMENT)
    expect(metrics.sentimentAccuracy).toEqual({ correct: 0, total: 0, rate: null })
    expect(metrics.orderAccuracy.rate).toBeNull()
    expect(metrics.registered).toMatchObject({ precision: null, recall: null, f1: null })
    expect(metrics.unknown).toMatchObject({ precision: null, recall: null })
  })

  it('1件もなければ、件数は0で割合はすべて null になる', () => {
    const metrics = aggregateScores([], WITH_SENTIMENT)
    expect(metrics.caseCount).toBe(0)
    expect(metrics.brandMentionAccuracy.rate).toBeNull()
  })
})
