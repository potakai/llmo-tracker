import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTRACTION_SCHEMA_VERSION } from '../src'
import { type GoldenCase, loadGoldenSet } from '../src/eval/golden'
import { loadReplaySource, parseReplaySource, replayOutcomes } from '../src/eval/replay'
import { scoreCase } from '../src/eval/score'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/llm-replay.json')
const SCORE_OPTIONS = { scoreSentiment: true }

async function replayCase(id: string) {
  const golden = await loadGoldenSet()
  const c = golden.find((g) => g.id === id) as GoldenCase
  const source = await loadReplaySource(FIXTURE_PATH)
  const [outcome] = replayOutcomes([c], source)
  if (!outcome) throw new Error('結果がありません')
  return {
    outcome,
    score: scoreCase(c.expected, outcome.error ? null : outcome.result, SCORE_OPTIONS),
  }
}

describe('保存済みの LLM 出力での再採点（replay）', () => {
  it.each([
    'acct-similar-name-suffix',
    'crm-similar-name-prefix',
    'acct-similar-name-other-product',
    'acct-url-only',
    'acct-generic-word-competitor',
    'crm-alias-both-forms',
    'acct-repeat-competitor',
  ])('%s を replay すると、全問正解になる', async (id) => {
    const { outcome, score } = await replayCase(id)
    expect(outcome.error).toBeNull()
    expect(score.passed).toBe(true)
  })

  it('ひらがなの「そらはた会計」はブランドとして数えるが、LLM が not_mentioned と返した感情は直せない', async () => {
    const { outcome, score } = await replayCase('acct-alias-unregistered-hiragana')
    expect(outcome.result?.mentions.map((m) => m.entityType)).toEqual(['brand', 'competitor'])
    expect(score).toMatchObject({ brandMentioned: true, brandRank: true, sentiment: false })
    expect(score.registered).toMatchObject({ falsePositives: 0, falseNegatives: 0 })
  })

  it('LLM が出典の中の名前を拾ったときは、突き合わせでは消さない（プロンプトで直す）', async () => {
    const { score } = await replayCase('acct-citation-title-only')
    expect(score.registered.extra).toEqual(['brand'])
  })

  it('保存したモデル名と、現在の抽出の仕様の版で結果を作り、API は呼ばない', async () => {
    const { outcome } = await replayCase('acct-url-only')
    expect(outcome.result).toMatchObject({
      extractorModel: 'gpt-5.4-mini',
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      brandMentioned: false,
      sentiment: null,
    })
  })

  it('フォールバックしたケース・読めない出力・失敗したケース・ないケースは、エラーとして記録する', async () => {
    const golden = await loadGoldenSet()
    const ids = ['acct-prose', 'acct-negative', 'kintai-negative', 'acct-list-brand-third']
    const cases = ids.map((id) => golden.find((g) => g.id === id) as GoldenCase)
    const source = await loadReplaySource(FIXTURE_PATH)

    const outcomes = replayOutcomes(cases, source)

    expect(outcomes.map((o) => o.result)).toEqual([null, null, null, null])
    expect(outcomes.map((o) => o.error)).toEqual([
      expect.stringMatching(/フォールバック.*timeout/),
      expect.stringMatching(/LLM の出力が読めません/),
      expect.stringMatching(/抽出に失敗/),
      expect.stringMatching(/このケースがありません/),
    ])
  })
})

describe('replay する結果ファイルの読み込み', () => {
  it('LLM 以外の抽出器の結果ファイルは、エラーになる', () => {
    expect(() =>
      parseReplaySource({ extractor: 'rule', modelId: 'rule-based', cases: [] }, 'x.json'),
    ).toThrow(/LLM の抽出器の結果/)
  })

  it('形が違う結果ファイルは、どこが違うかを書いたエラーになる', () => {
    expect(() => parseReplaySource({ extractor: 'llm', cases: 'x' }, 'x.json')).toThrow(/x\.json/)
  })

  it('replay した結果ファイルも、もう一度 replay できる', () => {
    const source = parseReplaySource(
      { extractor: 'llm-replay', modelId: 'gpt-5.4-mini', cases: [] },
      'x.json',
    )
    expect(source.modelId).toBe('gpt-5.4-mini')
  })

  it('ファイルがなければ、パスを書いたエラーになる', async () => {
    await expect(loadReplaySource('/no/such/file.json')).rejects.toThrow(/\/no\/such\/file\.json/)
  })
})
