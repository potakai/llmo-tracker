import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import {
  createLlmExtractor,
  createRuleBasedExtractor,
  type ExtractInput,
  type LlmExtraction,
  normalize,
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

  it('本文がひらがなで書かれていても、カタカナで登録した名前として見つける', async () => {
    const result = await createRuleBasedExtractor().extract(input('まねーふぉわーどが便利です'))
    expect(result.mentions).toEqual([
      { entityType: 'competitor', competitorId: 'c-b', name: 'マネーフォワード', rank: 1 },
    ])
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
        { name: 'MFクラウド' },
        { name: '◯◯会計' },
        { name: 'やよいの青色申告オンライン' }, // 重複は1つにまとめる
      ],
      brandSentiment: 'positive',
    }
    const text = 'やよい、MFクラウド、◯◯会計、それと freee もあります'
    expect(reconcile(input(text), llm)).toEqual([
      { entityType: 'unknown', competitorId: null, name: 'やよいの青色申告オンライン', rank: 1 },
      { entityType: 'competitor', competitorId: 'c-b', name: 'MFクラウド', rank: 2 },
      { entityType: 'brand', competitorId: null, name: '◯◯会計', rank: 3 },
    ])
  })

  it('LLM が拾わなかった登録済みの名前は、本文に出てきても足さない', () => {
    // Arrange：本文の出典の URL に freee が含まれるが、LLM は拾っていない
    const llm: LlmExtraction = { entities: [{ name: '◯◯会計' }], brandSentiment: 'positive' }
    const text = '◯◯会計がおすすめです。\n出典：https://freee.example.com/blog'

    // Act
    const mentions = reconcile(input(text), llm)

    // Assert
    expect(mentions).toEqual([{ entityType: 'brand', competitorId: null, name: '◯◯会計', rank: 1 }])
  })

  it('登録済みの名前を含むだけの別の名前は、登録済みの会社とみなさず unknown にする', () => {
    const llm: LlmExtraction = {
      entities: [{ name: 'freee人事労務' }, { name: 'ミ◯◯会計' }, { name: 'マネー' }],
      brandSentiment: 'not_mentioned',
    }
    expect(reconcile(input(''), llm)).toEqual([
      { entityType: 'unknown', competitorId: null, name: 'freee人事労務', rank: 1 },
      { entityType: 'unknown', competitorId: null, name: 'ミ◯◯会計', rank: 2 },
      { entityType: 'unknown', competitorId: null, name: 'マネー', rank: 3 },
    ])
  })

  it('括弧書きの付記を取り除いてから、登録済みの名前と完全一致で照らす', () => {
    const llm: LlmExtraction = {
      entities: [{ name: '◯◯会計（クラウド版）' }, { name: 'マネーフォワード(MF)' }],
      brandSentiment: 'positive',
    }
    expect(reconcile(input(''), llm)).toEqual([
      { entityType: 'brand', competitorId: null, name: '◯◯会計（クラウド版）', rank: 1 },
      { entityType: 'competitor', competitorId: 'c-b', name: 'マネーフォワード(MF)', rank: 2 },
    ])
  })

  it('括弧書きまで含めて完全一致する登録名があれば、括弧を除いた照合より先にそちらを使う', () => {
    // Arrange：自社「コヨミタイム」と、括弧書き付きの競合「コヨミタイム（給与版）」
    const kintai: ExtractInput = {
      answerText: '',
      brand: { name: 'コヨミタイム', aliases: [] },
      competitors: [{ id: 'c-pay', name: 'コヨミタイム（給与版）', aliases: [] }],
    }
    const llm: LlmExtraction = {
      entities: [{ name: 'コヨミタイム（給与版）' }, { name: 'コヨミタイム' }],
      brandSentiment: 'neutral',
    }

    // Act
    const mentions = reconcile(kintai, llm)

    // Assert
    expect(mentions).toEqual([
      { entityType: 'competitor', competitorId: 'c-pay', name: 'コヨミタイム（給与版）', rank: 1 },
      { entityType: 'brand', competitorId: null, name: 'コヨミタイム', rank: 2 },
    ])
  })

  it('ひらがなで書かれた名前も、カタカナで登録した名前と同じとみなす', () => {
    const llm: LlmExtraction = {
      entities: [{ name: 'まねーふぉわーど' }],
      brandSentiment: 'not_mentioned',
    }
    expect(reconcile(input(''), llm)).toEqual([
      { entityType: 'competitor', competitorId: 'c-b', name: 'まねーふぉわーど', rank: 1 },
    ])
  })
})

describe('表記の正規化', () => {
  it('ひらがなをカタカナに寄せる（ゝゞ もカタカナの踊り字にする）', () => {
    expect(normalize('そらはた会計')).toBe(normalize('ソラハタ会計'))
    expect(normalize('いすゞ')).toBe('イスヾ')
  })

  it('長音記号はそのまま残し、ひらがなの長音もカタカナと同じになる', () => {
    expect(normalize('らーめん')).toBe('ラーメン')
    expect(normalize('ラーメン')).not.toBe(normalize('ラメン'))
  })

  it('半角カタカナ・全角英数・大文字・空白の違いは、これまでどおりそろえる', () => {
    expect(normalize('ｺﾖﾐﾀｲﾑ')).toBe('コヨミタイム')
    expect(normalize('ＳＯＲＡＨＡＴＡ 会計')).toBe('sorahata会計')
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
