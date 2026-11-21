import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createLlmExtractor } from '../src'
import { parseEvalArgs } from '../src/eval/args'
import { createEvalExtractor } from '../src/eval/extractors'
import { formatReport } from '../src/eval/report'
import { resultFileName } from '../src/eval/results'
import { aggregateScores, type ScoreOptions, scoreCase } from '../src/eval/score'
import { createUsageTracker } from '../src/eval/usage'

describe('引数の解釈', () => {
  it('--extractor だけ指定すると、ほかは既定値になる（pnpm が渡す -- は無視する）', () => {
    expect(parseEvalArgs(['--', '--extractor', 'rule'])).toEqual({
      extractor: 'rule',
      only: null,
      concurrency: 4,
      replay: null,
    })
  })

  it('--only と --concurrency を指定できる', () => {
    expect(
      parseEvalArgs(['--extractor', 'llm', '--only', 'acct-prose', '--concurrency', '2']),
    ).toEqual({ extractor: 'llm', only: 'acct-prose', concurrency: 2, replay: null })
  })

  it('--extractor llm には --replay で結果ファイルを指定できる', () => {
    expect(parseEvalArgs(['--extractor', 'llm', '--replay', 'eval/results/a.json'])).toMatchObject({
      extractor: 'llm',
      replay: 'eval/results/a.json',
    })
  })

  it('--replay は --extractor llm でしか使えない', () => {
    expect(() => parseEvalArgs(['--extractor', 'rule', '--replay', 'a.json'])).toThrow(/--replay/)
  })

  it('--extractor がない、または rule / llm 以外だと、使い方つきのエラーになる', () => {
    expect(() => parseEvalArgs([])).toThrow(/--extractor rule\|llm/)
    expect(() => parseEvalArgs(['--extractor', 'gpt'])).toThrow(/--extractor rule\|llm/)
  })

  it('--concurrency が正の整数でないと、エラーになる', () => {
    expect(() => parseEvalArgs(['--extractor', 'rule', '--concurrency', '0'])).toThrow(
      /--concurrency/,
    )
    expect(() => parseEvalArgs(['--extractor', 'rule', '--concurrency', 'abc'])).toThrow(
      /--concurrency/,
    )
  })

  it('知らないオプションがあると、エラーになる', () => {
    expect(() => parseEvalArgs(['--extractor', 'rule', '--verbose'])).toThrow()
  })
})

describe('評価に使う抽出器', () => {
  it('rule なら、API キーがなくてもルールベースの抽出器を作る', () => {
    const created = createEvalExtractor('rule', {})
    expect(created).toMatchObject({ modelId: 'rule-based', usage: null })
  })

  it('rule は感情を返さない仕様なので感情を採点せず、llm は採点する', () => {
    expect(createEvalExtractor('rule', {}).scoreOptions).toEqual({ scoreSentiment: false })
    expect(createEvalExtractor('llm', { OPENAI_API_KEY: 'sk-test' }).scoreOptions).toEqual({
      scoreSentiment: true,
    })
  })

  it('llm で OPENAI_API_KEY がないと、分かりやすいエラーで止まる', () => {
    expect(() => createEvalExtractor('llm', {})).toThrow(/OPENAI_API_KEY/)
  })

  it('llm で EXTRACTOR_MODEL がなければ、本番と同じ既定のモデルを使う（API は呼ばない）', () => {
    const created = createEvalExtractor('llm', { OPENAI_API_KEY: 'sk-test' })
    expect(created.modelId).toBe('gpt-5.4-mini')
    expect(created.usage).not.toBeNull()
  })

  it('llm で EXTRACTOR_MODEL があれば、そのモデルを使う', () => {
    const created = createEvalExtractor('llm', {
      OPENAI_API_KEY: 'sk-test',
      EXTRACTOR_MODEL: 'gpt-other',
    })
    expect(created.modelId).toBe('gpt-other')
  })
})

describe('トークン数の集計', () => {
  it('包んだモデルを呼ぶたびに、入力・出力のトークン数を足し上げる', async () => {
    // Arrange
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              entities: [{ name: 'ソラハタ会計' }],
              brandSentiment: 'positive',
            }),
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 30, text: 30, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    const tracker = createUsageTracker(model)
    const extractor = createLlmExtractor({ model: tracker.model, modelId: 'mock-model' })
    const input = {
      answerText: 'ソラハタ会計',
      brand: { name: 'ソラハタ会計', aliases: [] },
      competitors: [],
    }

    // Act
    await extractor.extract(input)
    await extractor.extract(input)

    // Assert
    expect(tracker.totals()).toEqual({ calls: 2, inputTokens: 240, outputTokens: 60 })
  })
})

describe('結果の保存と表示', () => {
  it('結果のファイル名は <YYYYMMDD-HHmm>-<extractor>.json になる', () => {
    expect(resultFileName(new Date(2026, 10, 21, 9, 5), 'rule')).toBe('20261121-0905-rule.json')
  })

  it('レポートには指標の表と、外れたケースの id・外れた理由が出る', () => {
    // Arrange
    const score = scoreCase(expected, null, WITHOUT_SENTIMENT)

    // Act
    const report = formatReport({
      extractor: 'rule',
      modelId: 'rule-based',
      metrics: aggregateScores([score], WITHOUT_SENTIMENT),
      cases: [{ id: 'ng-case', note: 'メモ', expected, actual: null, score, error: '失敗' }],
      usage: null,
    })

    // Assert
    expect(report).toContain('ブランド言及の正解率')
    expect(report).toContain('登録済みの会社の F1')
    expect(report).toContain('ng-case')
    expect(report).toContain('抽出エラー: 失敗')
  })

  it('感情を採点しない抽出器なら、感情の正解率は「—」と対象外の理由を出し、全問正解に感情を含めていないと注記する', () => {
    // Arrange
    const actual = actualWith(null)
    const score = scoreCase(expected, actual, WITHOUT_SENTIMENT)

    // Act
    const report = formatReport({
      extractor: 'rule',
      modelId: 'rule-based',
      metrics: aggregateScores([score], WITHOUT_SENTIMENT),
      cases: [{ id: 'a', note: 'メモ', expected, actual, score, error: null }],
      usage: null,
    })

    // Assert
    expect(report).toContain('| 感情の正解率 | — | 対象外（この抽出器は感情を返さない） |')
    expect(report).toContain('全問正解の判定に感情を含めていない')
  })

  it('感情を採点する抽出器なら、注記は出さない', () => {
    const actual = actualWith('positive')
    const score = scoreCase(expected, actual, WITH_SENTIMENT)
    const report = formatReport({
      extractor: 'llm',
      modelId: 'mock-model',
      metrics: aggregateScores([score], WITH_SENTIMENT),
      cases: [{ id: 'a', note: 'メモ', expected, actual, score, error: null }],
      usage: null,
    })
    expect(report).toContain('| 感情の正解率 | 100.0% | 1 / 1 |')
    expect(report).not.toContain('全問正解の判定に感情を含めていない')
  })

  it('感情だけが外れたケースは、詳細を出さずに1行にまとめ、各 id に「正解 → 抽出値」を添える', () => {
    // Arrange：ブランドも順位も合っているが、感情が違う（または返していない）
    const wrong = actualWith('neutral')
    const missing = actualWith(null)
    const scoreWrong = scoreCase(expected, wrong, WITH_SENTIMENT)
    const scoreMissing = scoreCase(expected, missing, WITH_SENTIMENT)

    // Act
    const report = formatReport({
      extractor: 'llm',
      modelId: 'mock-model',
      metrics: aggregateScores([scoreWrong, scoreMissing], WITH_SENTIMENT),
      cases: [
        { id: 'wrong', note: 'メモ', expected, actual: wrong, score: scoreWrong, error: null },
        {
          id: 'missing',
          note: 'メモ',
          expected,
          actual: missing,
          score: scoreMissing,
          error: null,
        },
      ],
      usage: null,
    })

    // Assert
    expect(report).toContain(
      '感情だけが外れたケース（2 件）: wrong（positive → neutral）, missing（positive → null）',
    )
    expect(report).not.toContain('■ wrong')
  })
})

const WITH_SENTIMENT: ScoreOptions = { scoreSentiment: true }
const WITHOUT_SENTIMENT: ScoreOptions = { scoreSentiment: false }

/** 正解：ブランドが1位で positive */
const expected = {
  brandMentioned: true,
  brandRank: 1,
  sentiment: 'positive' as const,
  mentions: [{ entityType: 'brand' as const, competitorId: null, name: 'ソラハタ会計' }],
}

/** ブランドも順位も合っていて、感情だけを変えた抽出結果 */
function actualWith(sentiment: 'positive' | 'neutral' | 'negative' | null) {
  return {
    brandMentioned: true,
    brandRank: 1,
    sentiment,
    mentions: [{ entityType: 'brand' as const, competitorId: null, name: 'ソラハタ会計', rank: 1 }],
  }
}
