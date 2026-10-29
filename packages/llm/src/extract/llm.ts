import { generateText, type LanguageModel, Output } from 'ai'
import { z } from 'zod'
import {
  extractByRules,
  findFirstOccurrence,
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
      '回答の中で紹介・推薦・比較されている会社名・サービス名・製品名を、回答に出てくる順に。「会計ソフト」のような一般名詞は含めない',
    ),
  brandSentiment: z
    .enum(['positive', 'neutral', 'negative', 'not_mentioned'])
    .describe('対象ブランドが回答の中でどう書かれているか。出てこなければ not_mentioned'),
})

export type LlmExtraction = z.infer<typeof llmExtractionSchema>

const SYSTEM = [
  'あなたは、AI アシスタントの回答を分析するアナリストです。',
  '与えられた回答から、言及されている会社・サービス・製品を登場順に抜き出し、',
  '対象ブランドがどのように書かれているかを判定してください。',
  '回答に書かれていないことは推測で足さないでください。',
].join('\n')

export function buildExtractionPrompt(input: ExtractInput): string {
  const brandNames = [input.brand.name, ...input.brand.aliases].join(' / ')
  return [`対象ブランド: ${brandNames}`, '', '--- 回答 ---', input.answerText].join('\n')
}

/**
 * LLM の結果と、登録済みの名前のマッチングを突き合わせる。
 * - 順番は LLM の並び（箇条書きや文脈を理解しているので信頼できる）
 * - LLM の名前は、登録済みの名前・別名と照らして brand / competitor / unknown に振り分ける
 * - LLM が拾い漏らした登録済みの名前は、本文に出てくる位置の順で後ろに足す
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
    } else {
      const key = normalize(name)
      if (!key || seenUnknown.has(key)) continue
      seenUnknown.add(key)
      ordered.push({ entityType: 'unknown', competitorId: null, name })
    }
  }

  const missed = entities
    .filter((e) => !used.has(e))
    .flatMap((e) => {
      const found = findFirstOccurrence(input.answerText, e)
      return found ? [{ e, ...found }] : []
    })
    .sort((a, b) => a.index - b.index)
  for (const { e, name } of missed) {
    ordered.push({ entityType: e.entityType, competitorId: e.competitorId, name })
  }

  return ordered.map((m, i) => ({ ...m, rank: i + 1 }))
}

function matchEntity(name: string, entities: RegisteredEntity[]): RegisteredEntity | undefined {
  const target = normalize(name)
  // 完全一致を優先し、なければ「どちらかがもう一方を含む」で探す（2文字以上の名前だけ）
  return (
    entities.find((e) => e.names.some((n) => normalize(n) === target)) ??
    entities.find((e) =>
      e.names.some((n) => {
        const candidate = normalize(n)
        return candidate.length >= 2 && (target.includes(candidate) || candidate.includes(target))
      }),
    )
  )
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
        })
        const llm = llmExtractionSchema.parse(output)
        const mentions = reconcile(input, llm)
        const summary = summarize(mentions)
        return {
          ...summary,
          sentiment:
            summary.brandMentioned && llm.brandSentiment !== 'not_mentioned'
              ? llm.brandSentiment
              : null,
          mentions,
          extractorModel: options.modelId,
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
          raw: llm,
        }
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
