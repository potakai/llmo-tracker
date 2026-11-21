import {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractedMention,
  type ExtractInput,
  type ExtractionResult,
  type Extractor,
} from './types'

/** ひらがな（ぁ〜ゖ）と踊り字（ゝゞ）を、対応するカタカナにする。コードポイントの差は 0x60 */
const HIRAGANA = /[ぁ-ゖゝゞ]/g
const HIRAGANA_TO_KATAKANA_OFFSET = 0x60

function hiraganaToKatakana(value: string): string {
  return value.replace(HIRAGANA, (ch) =>
    String.fromCodePoint((ch.codePointAt(0) ?? 0) + HIRAGANA_TO_KATAKANA_OFFSET),
  )
}

/**
 * 表記の揺れをそろえる。全角・半角、大文字・小文字、空白、ひらがな・カタカナの違いを無視する
 * （「ＡＢＣ会計」と「abc会計」、「そらはた会計」と「ソラハタ会計」を同じとみなす）。
 * 長音記号（ー）は消さない（「ラーメン」と「ラメン」は別物）
 */
export function normalize(value: string): string {
  return hiraganaToKatakana(value.normalize('NFKC').toLowerCase().replace(/\s+/g, ''))
}

export type RegisteredEntity = {
  entityType: 'brand' | 'competitor'
  competitorId: string | null
  names: string[]
}

export function registeredEntities(input: ExtractInput): RegisteredEntity[] {
  return [
    { entityType: 'brand', competitorId: null, names: [input.brand.name, ...input.brand.aliases] },
    ...input.competitors.map((c) => ({
      entityType: 'competitor' as const,
      competitorId: c.id,
      names: [c.name, ...c.aliases],
    })),
  ]
}

/**
 * 登録済みの名前（別名を含む）が回答のどこに最初に出てくるかを探す。
 * 見つからなければ null。
 */
export function findFirstOccurrence(
  text: string,
  entity: RegisteredEntity,
): { index: number; name: string } | null {
  const haystack = normalize(text)
  let best: { index: number; name: string } | null = null
  for (const name of entity.names) {
    const needle = normalize(name)
    if (!needle) continue
    const index = haystack.indexOf(needle)
    if (index >= 0 && (best === null || index < best.index)) best = { index, name }
  }
  return best
}

/** 登録済みの名前が文中に出てくるかだけで判定する。速くて無料だが、未登録の会社と言い回しはわからない */
export function extractByRules(input: ExtractInput): ExtractedMention[] {
  return registeredEntities(input)
    .flatMap((entity) => {
      const found = findFirstOccurrence(input.answerText, entity)
      return found ? [{ entity, ...found }] : []
    })
    .sort((a, b) => a.index - b.index)
    .map(({ entity, name }, i) => ({
      entityType: entity.entityType,
      competitorId: entity.competitorId,
      name,
      rank: i + 1,
    }))
}

export function summarize(
  mentions: ExtractedMention[],
): Pick<ExtractionResult, 'brandMentioned' | 'brandRank'> {
  const brand = mentions.find((m) => m.entityType === 'brand')
  return { brandMentioned: brand !== undefined, brandRank: brand?.rank ?? null }
}

export function createRuleBasedExtractor(): Extractor {
  return {
    async extract(input) {
      const mentions = extractByRules(input)
      return {
        ...summarize(mentions),
        sentiment: null,
        mentions,
        extractorModel: 'rule-based',
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        raw: null,
      }
    },
  }
}
