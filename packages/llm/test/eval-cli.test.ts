import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createLlmExtractor } from '../src'
import { parseEvalArgs } from '../src/eval/args'
import { createEvalExtractor } from '../src/eval/extractors'
import { formatReport } from '../src/eval/report'
import { resultFileName } from '../src/eval/results'
import { aggregateScores, scoreCase } from '../src/eval/score'
import { createUsageTracker } from '../src/eval/usage'

describe('引数の解釈', () => {
  it('--extractor だけ指定すると、ほかは既定値になる（pnpm が渡す -- は無視する）', () => {
    expect(parseEvalArgs(['--', '--extractor', 'rule'])).toEqual({
      extractor: 'rule',
      only: null,
      concurrency: 4,
    })
  })

  it('--only と --concurrency を指定できる', () => {
    expect(
      parseEvalArgs(['--extractor', 'llm', '--only', 'acct-prose', '--concurrency', '2']),
    ).toEqual({ extractor: 'llm', only: 'acct-prose', concurrency: 2 })
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
            text: JSON.stringify({ entities: [{ name: 'ソラ会計' }], brandSentiment: 'positive' }),
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
      answerText: 'ソラ会計',
      brand: { name: 'ソラ会計', aliases: [] },
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
    const expected = {
      brandMentioned: true,
      brandRank: 1,
      sentiment: 'positive' as const,
      mentions: [{ entityType: 'brand' as const, competitorId: null, name: 'ソラ会計' }],
    }
    const cases = [
      { id: 'ok-case', note: '正解', expected, score: scoreCase(expected, null), error: '失敗' },
    ]

    // Act
    const report = formatReport({
      extractor: 'rule',
      modelId: 'rule-based',
      metrics: aggregateScores(cases.map((c) => c.score)),
      cases: cases.map((c) => ({ ...c, actual: null })),
      usage: null,
    })

    // Assert
    expect(report).toContain('ブランド言及の正解率')
    expect(report).toContain('登録済みの会社の F1')
    expect(report).toContain('ok-case')
    expect(report).toContain('抽出エラー: 失敗')
  })

  it('感情の正解率が対象外（null）なら、表には「—」と対象外の理由を出す', () => {
    // Arrange：感情を返さない抽出器の結果
    const expected = {
      brandMentioned: true,
      brandRank: 1,
      sentiment: 'positive' as const,
      mentions: [{ entityType: 'brand' as const, competitorId: null, name: 'ソラ会計' }],
    }
    const actual = {
      brandMentioned: true,
      brandRank: 1,
      sentiment: null,
      mentions: [{ ...expected.mentions[0]!, rank: 1 }],
    }
    const score = scoreCase(expected, actual)

    // Act
    const report = formatReport({
      extractor: 'rule',
      modelId: 'rule-based',
      metrics: aggregateScores([score]),
      cases: [{ id: 'a', note: 'メモ', expected, actual, score, error: null }],
      usage: null,
    })

    // Assert
    expect(report).toContain('| 感情の正解率 | — | 対象外（抽出器が感情を返さない） |')
  })

  it('感情だけが外れたケースは、詳細を出さずに id を1行にまとめる', () => {
    // Arrange：ブランドも順位も合っているが、感情を返していない
    const expected = {
      brandMentioned: true,
      brandRank: 1,
      sentiment: 'positive' as const,
      mentions: [{ entityType: 'brand' as const, competitorId: null, name: 'ソラ会計' }],
    }
    const actual = {
      brandMentioned: true,
      brandRank: 1,
      sentiment: null,
      mentions: [{ ...expected.mentions[0]!, rank: 1 }],
    }
    const score = scoreCase(expected, actual)

    // Act
    const report = formatReport({
      extractor: 'rule',
      modelId: 'rule-based',
      metrics: aggregateScores([score]),
      cases: [{ id: 'only-sentiment', note: 'メモ', expected, actual, score, error: null }],
      usage: null,
    })

    // Assert
    expect(report).toContain('感情だけが外れたケース（1 件）: only-sentiment')
    expect(report).not.toContain('■ only-sentiment')
  })
})
