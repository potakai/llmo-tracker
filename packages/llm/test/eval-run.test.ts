import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createLlmExtractor, createRuleBasedExtractor, type Extractor } from '../src'
import { type GoldenCase, loadGoldenSet } from '../src/eval/golden'
import { runExtraction } from '../src/eval/run'
import { aggregateScores, scoreCases } from '../src/eval/score'

const caseOf = (id: string): GoldenCase => ({
  id,
  note: 'テスト用',
  input: {
    answerText: `${id}：ソラハタ会計がおすすめです`,
    brand: { name: 'ソラハタ会計', aliases: [] },
    competitors: [],
  },
  expected: {
    brandMentioned: true,
    brandRank: 1,
    sentiment: 'positive',
    mentions: [{ entityType: 'brand', competitorId: null, name: 'ソラハタ会計' }],
  },
})

const OPTIONS = { concurrency: 4, timeoutMs: 5_000 }

describe('抽出の実行', () => {
  it('ルールベースでゴールデンセットを全件流すと、例外が出ずに完走し、全件の結果がそろう', async () => {
    // Arrange
    const cases = await loadGoldenSet()

    // Act
    const outcomes = await runExtraction(cases, createRuleBasedExtractor(), OPTIONS)
    const options = { scoreSentiment: false }
    const metrics = aggregateScores(
      scoreCases(
        outcomes.map((o, i) => ({
          expected: cases[i]!.expected,
          actual: o.error ? null : o.result,
        })),
        options,
      ),
      options,
    )

    // Assert
    expect(outcomes.map((o) => o.id)).toEqual(cases.map((c) => c.id))
    expect(outcomes.every((o) => o.error === null && o.result !== null)).toBe(true)
    expect(metrics.caseCount).toBe(cases.length)
  })

  it('抽出器が例外を投げても全体は止まらず、そのケースだけエラーとして記録される', async () => {
    // Arrange：2件目だけ失敗する抽出器
    const rule = createRuleBasedExtractor()
    const flaky: Extractor = {
      async extract(input) {
        if (input.answerText.startsWith('b')) throw new Error('タイムアウトしました')
        return rule.extract(input)
      },
    }

    // Act
    const outcomes = await runExtraction([caseOf('a'), caseOf('b'), caseOf('c')], flaky, OPTIONS)

    // Assert
    expect(outcomes.map((o) => o.error)).toEqual([null, 'Error: タイムアウトしました', null])
    expect(outcomes[1]!.result).toBeNull()
  })

  it('LLM の抽出器がルールベースにフォールバックしたら、そのケースはエラーとして記録される', async () => {
    // Arrange：スキーマに合わない JSON を返すモデル
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ entities: '壊れた出力' }) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    })
    const extractor = createLlmExtractor({ model, modelId: 'mock-model' })

    // Act
    const [outcome] = await runExtraction([caseOf('a')], extractor, OPTIONS)

    // Assert：結果は詳細のために残しつつ、エラーとして数える
    expect(outcome!.error).toMatch(/^ルールベースにフォールバックしました/)
    expect(outcome!.result?.extractorModel).toBe('rule-based')
  })

  it('同時に動かす抽出の数は concurrency を超えず、結果はケースの順番どおりに並ぶ', async () => {
    // Arrange：後のケースほど早く終わる抽出器で、同時実行数を数える
    const rule = createRuleBasedExtractor()
    let running = 0
    let maxRunning = 0
    const cases = ['a', 'b', 'c', 'd', 'e'].map(caseOf)
    const slow: Extractor = {
      async extract(input) {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        const delay = 50 - cases.findIndex((c) => c.input.answerText === input.answerText) * 10
        await new Promise((resolve) => setTimeout(resolve, delay))
        running -= 1
        return rule.extract(input)
      },
    }

    // Act
    const outcomes = await runExtraction(cases, slow, { ...OPTIONS, concurrency: 2 })

    // Assert
    expect(maxRunning).toBe(2)
    expect(outcomes.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('抽出器には、時間を区切った abortSignal を渡す', async () => {
    const rule = createRuleBasedExtractor()
    const signals: (AbortSignal | undefined)[] = []
    const spy: Extractor = {
      async extract(input) {
        signals.push(input.abortSignal)
        return rule.extract(input)
      },
    }

    await runExtraction([caseOf('a')], spy, OPTIONS)

    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
})
