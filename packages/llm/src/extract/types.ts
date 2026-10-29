/**
 * 抽出の仕様が変わったら上げる。analysis.schema_version に保存し、
 * 古い版で抽出した回答だけを再分析できるようにする。
 */
export const EXTRACTION_SCHEMA_VERSION = 1

export type ExtractInput = {
  answerText: string
  brand: { name: string; aliases: string[] }
  competitors: { id: string; name: string; aliases: string[] }[]
}

export type ExtractedMention = {
  entityType: 'brand' | 'competitor' | 'unknown'
  /** entityType が competitor のときだけ */
  competitorId: string | null
  /** 回答中の表記 */
  name: string
  /** 登場順（1始まり） */
  rank: number
}

export type ExtractionResult = {
  brandMentioned: boolean
  brandRank: number | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  mentions: ExtractedMention[]
  /** どの方法で抽出したか（モデル名、または rule-based） */
  extractorModel: string
  schemaVersion: number
  /** 抽出の生データ（LLM の出力やフォールバックの理由）。後から検証できるように残す */
  raw: unknown
}

export interface Extractor {
  extract(input: ExtractInput): Promise<ExtractionResult>
}
