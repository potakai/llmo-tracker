/**
 * 否定的と判定された回答から、自社について否定的に書いている箇所を探す。
 * 抽出（ルールベース・LLM）は「否定的かどうか」しか返さないので、どの文かはここで言い回しから推し量る。
 * 見つからないときは null を返し、画面では回答全体を開くように案内する。
 */
import { normalize } from '@llmo/llm'

/** 抜き出した文の最大の長さ */
const MAX_SENTENCE_LENGTH = 120

/**
 * 否定的な言い回しの手がかり。完全ではないので、見つからなければ箇所を特定しない
 * （たまたま含まれる言葉で、関係のない文を「否定的」として見せないように、短すぎる語は入れない）
 */
export const NEGATIVE_CUES = [
  '遅い',
  '難しい',
  'わかりにくい',
  '分かりにくい',
  '使いにくい',
  '不満',
  '不便',
  '不安',
  '欠点',
  'デメリット',
  '弱点',
  '注意が必要',
  '懸念',
  'トラブル',
  '評判が悪',
  '悪い',
  '劣る',
  '物足りない',
  '割高',
  '向いていない',
  '向いていません',
  'おすすめしません',
  // 「〜という声も」：口コミとして否定的な評判を紹介するときの言い方
  '声も',
  '批判',
  '苦情',
] as const

/** 否定的な箇所と、その前後の文（前後がなければ null） */
export type NegativePassage = {
  before: string | null
  focus: string
  after: string | null
}

/** 箇条書きの記号（「- 」「1. 」「・」など）を文頭から外す */
const LIST_MARKER = /^(?:[-*・•]|\d+[.)．])\s*/

/** 文の終わり（。！？!?）か改行で区切る */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n|(?<=[。！？!?])/)
    .map((s) => s.trim().replace(LIST_MARKER, '').replace(/\*\*/g, '').trim())
    .filter((s) => s.length > 0)
}

function truncate(sentence: string): string {
  return sentence.length > MAX_SENTENCE_LENGTH
    ? `${sentence.slice(0, MAX_SENTENCE_LENGTH)}…`
    : sentence
}

/** 名前（表記ゆれ・別名を含む）のどれかが文に出てくるか */
function mentionsAny(sentence: string, names: string[]): boolean {
  const haystack = normalize(sentence)
  return names.map(normalize).some((n) => n.length > 0 && haystack.includes(n))
}

function hasNegativeCue(sentence: string): boolean {
  return NEGATIVE_CUES.some((cue) => sentence.includes(cue))
}

/** 社名の文 i のまわりで、否定的な言い回しの文を探す（社名の文 → 次の文 → 前の文の順） */
function negativeSentenceNear(sentences: string[], i: number, otherNames: string[]): number | null {
  for (const k of [i, i + 1, i - 1]) {
    const sentence = sentences[k]
    if (sentence === undefined || !hasNegativeCue(sentence)) continue
    // 隣の文がほかの会社のことを書いているなら、自社についての文ではない
    if (k !== i && mentionsAny(sentence, otherNames)) continue
    return k
  }
  return null
}

/**
 * 回答の中で、自社について否定的に書いている箇所を、前後の文とあわせて返す。
 * 社名が出てくる文を最初から順に見て、最初に見つかった箇所を返す。見つからなければ null
 */
export function findNegativePassage(
  text: string,
  brandNames: string[],
  otherNames: string[],
): NegativePassage | null {
  const sentences = splitSentences(text)
  for (const [i, sentence] of sentences.entries()) {
    if (!mentionsAny(sentence, brandNames)) continue
    const k = negativeSentenceNear(sentences, i, otherNames)
    if (k === null) continue
    const before = sentences[k - 1]
    const after = sentences[k + 1]
    return {
      before: before === undefined ? null : truncate(before),
      focus: truncate(sentences[k] ?? ''),
      after: after === undefined ? null : truncate(after),
    }
  }
  return null
}
