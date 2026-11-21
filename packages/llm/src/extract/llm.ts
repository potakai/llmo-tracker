import { generateText, type LanguageModel, Output } from 'ai'
import { z } from 'zod'
import {
  extractByRules,
  normalize,
  type RegisteredEntity,
  registeredEntities,
  summarize,
} from './rule-based'
import {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractedMention,
  type ExtractInput,
  type ExtractionResult,
  type Extractor,
} from './types'

/**
 * LLM に返させる形。AI SDK がこのスキーマを JSON Schema にしてモデルに渡し、
 * 返ってきた JSON をこのスキーマで検証する（形が違えばエラーになり、ルールベースにフォールバック）。
 */
export const llmExtractionSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1).describe('回答に書かれている表記のまま'),
      }),
    )
    .max(30)
    .describe(
      [
        '回答の本文の中で紹介・推薦・比較されている会社名・サービス名・製品名を、本文に出てくる順に。',
        'URL、出典・参考文献の欄、記事タイトルの中だけに出てくる名前は含めない。',
        '「会計ソフト」「かんたん」「バランス」「他社」のような一般名詞は、登録済みの名前と同じ文字列でも含めない',
      ].join(''),
    ),
  brandSentiment: z
    .enum(['positive', 'neutral', 'negative', 'not_mentioned'])
    .describe(
      [
        '対象ブランドが回答の本文の中でどう書かれているか。',
        'positive：はっきり勧めている、評価している。',
        'negative：短所だけを書いている、勧めない、他社を勧める（遠回しな言い方を含む）。',
        'neutral：事実や機能を並べているだけ、長所と短所の両方を書いている、推薦ではない言及（「比較から外した」など）。',
        '順位は根拠にしない。本文に出てこなければ not_mentioned',
      ].join(''),
    ),
})

export type LlmExtraction = z.infer<typeof llmExtractionSchema>

const SYSTEM = [
  'あなたは、AI アシスタントの回答を分析するアナリストです。',
  '与えられた回答から、言及されている会社・サービス・製品を登場順に抜き出し、',
  '対象ブランドがどのように書かれているかを判定してください。',
  '回答に書かれていないことは推測で足さないでください。',
  '',
  '# 抜き出さないもの',
  '- URL、出典・参考文献の欄、記事タイトルの中だけに出てくる名前（本文で紹介されていなければ言及ではない）',
  '- 一般名詞（「かんたん」「バランス」など）。登録済みの名前と同じ文字列でも、その会社・製品を指していなければ含めない',
  '',
  '# 対象ブランドの見分け方',
  '- ひらがな・カタカナ・英字など、表記が違っても対象ブランドを指していれば対象ブランドとして扱う',
  '- 対象ブランドの名前を含むだけの別の会社・製品（前後に別の語が付いたもの）は、対象ブランドではない',
  '',
  '# 対象ブランドの感情の基準',
  '- positive：はっきり勧めている、評価している',
  '- negative：短所だけを書いている。勧めない、他社を勧める（遠回しな言い方を含む）',
  '- neutral：事実や機能を並べているだけ。長所と短所の両方を書いている。「比較から外した」など、推薦ではない言及',
  '- 何位に出てくるか（順位）は、感情の根拠にしない',
].join('\n')

export function buildExtractionPrompt(input: ExtractInput): string {
  const brandNames = [input.brand.name, ...input.brand.aliases].join(' / ')
  return [`対象ブランド: ${brandNames}`, '', '--- 回答 ---', input.answerText].join('\n')
}

/**
 * LLM の結果を、登録済みの名前と突き合わせる。
 * - 順番は LLM の並び（箇条書きや文脈を理解しているので信頼できる）
 * - LLM の名前は、登録済みの名前・別名と照らして brand / competitor / unknown に振り分ける
 * - LLM が拾わなかった名前は足さない（URL・出典・一般名詞を拾ってしまうため）
 */
export function reconcile(input: ExtractInput, llm: LlmExtraction): ExtractedMention[] {
  const entities = registeredEntities(input)
  const used = new Set<RegisteredEntity>()
  const seenUnknown = new Set<string>()
  const ordered: Omit<ExtractedMention, 'rank'>[] = []

  for (const { name } of llm.entities) {
    const matched = matchEntity(name, entities)
    if (matched) {
      if (used.has(matched)) continue
      used.add(matched)
      ordered.push({ entityType: matched.entityType, competitorId: matched.competitorId, name })
      continue
    }
    const key = normalize(name)
    if (!key || seenUnknown.has(key)) continue
    seenUnknown.add(key)
    ordered.push({ entityType: 'unknown', competitorId: null, name })
  }

  return ordered.map((m, i) => ({ ...m, rank: i + 1 }))
}

/** 括弧書きの付記（「（クラウド版）」など）。normalize で全角の括弧は半角になっている */
const PARENTHETICAL = /\([^()]*\)/g

/** 照合に使う表記：normalize したものと、そこから括弧書きを取り除いたもの */
function matchKeys(name: string): string[] {
  const normalized = normalize(name)
  const stripped = normalized.replace(PARENTHETICAL, '')
  return [...new Set([normalized, stripped])].filter((k) => k !== '')
}

/**
 * 登録済みの名前・別名と、表記をそろえたうえでの完全一致だけで照らす。
 * 含んでいるかどうかでは一致とみなさない（「ミソラハタ会計」は「ソラハタ会計」ではない）
 */
function matchEntity(name: string, entities: RegisteredEntity[]): RegisteredEntity | undefined {
  const targets = matchKeys(name)
  return entities.find((e) => e.names.some((n) => matchKeys(n).some((k) => targets.includes(k))))
}

/** LLM の出力から抽出結果を作る。本番の抽出と、評価の replay で同じものを使う */
export function buildLlmExtractionResult(
  input: ExtractInput,
  llm: LlmExtraction,
  modelId: string,
): ExtractionResult {
  const mentions = reconcile(input, llm)
  const summary = summarize(mentions)
  return {
    ...summary,
    sentiment:
      summary.brandMentioned && llm.brandSentiment !== 'not_mentioned' ? llm.brandSentiment : null,
    mentions,
    extractorModel: modelId,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    raw: llm,
  }
}

/** LLM で抽出する。失敗したらルールベースの結果を返す（どちらで抽出したかは extractorModel に残る） */
export function createLlmExtractor(options: { model: LanguageModel; modelId: string }): Extractor {
  return {
    async extract(input): Promise<ExtractionResult> {
      try {
        const { output } = await generateText({
          model: options.model,
          system: SYSTEM,
          prompt: buildExtractionPrompt(input),
          output: Output.object({ schema: llmExtractionSchema, name: 'answer_analysis' }),
          maxRetries: 2,
          abortSignal: input.abortSignal,
        })
        return buildLlmExtractionResult(input, llmExtractionSchema.parse(output), options.modelId)
      } catch (error) {
        const mentions = extractByRules(input)
        return {
          ...summarize(mentions),
          sentiment: null,
          mentions,
          extractorModel: 'rule-based',
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
          raw: { fallbackFrom: options.modelId, error: String(error).slice(0, 500) },
        }
      }
    },
  }
}
