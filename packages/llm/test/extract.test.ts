import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import {
  createLlmExtractor,
  createRuleBasedExtractor,
  type ExtractInput,
  type LlmExtraction,
  reconcile,
} from '../src'

const input = (answerText: string): ExtractInput => ({
  answerText,
  brand: { name: '◯◯会計', aliases: ['MaruKaikei'] },
  competitors: [
    { id: 'c-a', name: 'freee会計', aliases: ['freee'] },
    {
      id: 'c-b',
      name: 'マネーフォワード クラウド会計',
      aliases: ['マネーフォワード', 'MFクラウド'],
    },
  ],
})

describe('ルールベースの抽出', () => {
  it('登録済みの名前と別名を、全角半角・大文字小文字の違いを無視して見つけ、登場順に並べる', async () => {
    const result = await createRuleBasedExtractor().extract(
      input('おすすめは１．ＦＲＥＥＥ、２．marukaikei、３．やよいの青色申告です。'),
    )
    expect(result.mentions).toEqual([
      { entityType: 'competitor', competitorId: 'c-a', name: 'freee', rank: 1 },
      { entityType: 'brand', competitorId: null, name: 'MaruKaikei', rank: 2 },
    ])
    expect(result).toMatchObject({ brandMentioned: true, brandRank: 2, sentiment: null })
    // 未登録の「やよい」はルールベースではわからない
  })

  it('自社が出てこなければ brandMentioned は false', async () => {
    const result = await createRuleBasedExtractor().extract(input('freee がおすすめです'))
    expect(result).toMatchObject({ brandMentioned: false, brandRank: null })
  })
})

describe('LLM の結果との突き合わせ', () => {
  it('LLM の順番を使い、登録済みの名前に振り分け、未登録は unknown にする', () => {
    const llm: LlmExtraction = {
      entities: [
        { name: 'やよいの青色申告オンライン' },
        { name: 'MFクラウド会計' },
        { name: '◯◯会計' },
        { name: 'やよいの青色申告オンライン' }, // 重複は1つにまとめる
      ],
      brandSentiment: 'positive',
    }
    const text = 'やよい、MFクラウド会計、◯◯会計、それと freee もあります'
    expect(reconcile(input(text), llm)).toEqual([
      { entityType: 'unknown', competitorId: null, name: 'やよいの青色申告オンライン', rank: 1 },
      { entityType: 'competitor', competitorId: 'c-b', name: 'MFクラウド会計', rank: 2 },
      { entityType: 'brand', competitorId: null, name: '◯◯会計', rank: 3 },
      // LLM が拾い漏らした登録済みの名前は、本文の位置順で後ろに足す
      { entityType: 'competitor', competitorId: 'c-a', name: 'freee', rank: 4 },
    ])
  })
})

/** AI SDK のモックモデル：決まった JSON を返す */
function mockModel(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(json) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    }),
  })
}

describe('LLM での抽出（モックモデル）', () => {
  it('Zod スキーマどおりの JSON が返れば、それを使う', async () => {
    const extractor = createLlmExtractor({
      model: mockModel({
        entities: [{ name: 'freee会計' }, { name: '◯◯会計' }],
        brandSentiment: 'negative',
      }),
      modelId: 'mock-model',
    })
    const result = await extractor.extract(input('freee会計と◯◯会計を比べると…'))
    expect(result).toMatchObject({
      brandMentioned: true,
      brandRank: 2,
      sentiment: 'negative',
      extractorModel: 'mock-model',
    })
  })

  it('スキーマに合わない JSON が返ったら、ルールベースにフォールバックする', async () => {
    const extractor = createLlmExtractor({
      model: mockModel({ entities: 'これは配列ではない' }),
      modelId: 'mock-model',
    })
    const result = await extractor.extract(input('◯◯会計がおすすめです'))
    expect(result).toMatchObject({
      brandMentioned: true,
      brandRank: 1,
      sentiment: null,
      extractorModel: 'rule-based',
    })
    expect(result.raw).toMatchObject({ fallbackFrom: 'mock-model' })
  })

  it('abortSignal の時間を過ぎても LLM が返らなければ、待たずにルールベースにフォールバックする', async () => {
    // Arrange：abortSignal で止められるまで返らないモデル（signal がなければ 1 秒後に返す）
    const extractor = createLlmExtractor({ model: slowModel(1_000), modelId: 'mock-model' })

    // Act
    const startedAt = Date.now()
    const result = await extractor.extract({
      ...input('◯◯会計がおすすめです'),
      abortSignal: AbortSignal.timeout(ABORT_AFTER_MS),
    })

    // Assert
    expect(result).toMatchObject({ brandMentioned: true, extractorModel: 'rule-based' })
    expect(result.raw).toMatchObject({ fallbackFrom: 'mock-model' })
    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})

const ABORT_AFTER_MS = 50

/** abortSignal で止められるまで返らないモデル。signal がなければ delayMs 後に正しい JSON を返す */
function slowModel(delayMs: number) {
  const valid = mockModel({ entities: [{ name: '◯◯会計' }], brandSentiment: 'positive' })
  return new MockLanguageModelV4({
    doGenerate: (options) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(valid.doGenerate(options)), delayMs)
        options.abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(options.abortSignal?.reason)
        })
      }),
  })
}
