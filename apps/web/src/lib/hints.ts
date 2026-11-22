/**
 * 改善のヒント：直近の回答から、クライアントが次にやることを機械的に見つける。
 * DB には触らない（集めた回答を渡すと、施策の一覧を返す）。しきい値と優先度の計算はここに集める。
 */
import { normalize } from '@llmo/llm'

/** 何日分の回答から見つけるか */
export const HINT_WINDOW_DAYS = 14
/** これより回答が少ないときは、施策を出さない（少ないデータで断定しない） */
export const MIN_RESPONSES = 50
/** 割合を比べる母数（質問への回答・引用のある回答など）の最小 */
export const MIN_GROUP_RESPONSES = 10
/** 載るべきサイト：競合が出た回答で、少なくともこの件数は引用されていること */
export const MIN_SITE_CITATIONS = 5
/** 気になる点：否定的な回答がこの件数以上あること（1 件だけならたまたまかもしれない） */
export const MIN_NEGATIVE_RESPONSES = 2
/** 競合と自社の割合の差が、これ以上なら施策にする */
export const MIN_GAP = 0.2
/** 自社サイトが引用された回答の割合が、これ未満なら「ほとんど参考にされていない」 */
export const OWN_SITE_RARE_RATE = 0.1
/** 一度に出す施策の数 */
export const MAX_HINTS = 5
/** 同じ種類の施策ばかり並ばないように、1 種類あたりの上限 */
export const MAX_HINTS_PER_KIND = 2
/** 根拠として見せる回答の数 */
export const EVIDENCE_LIMIT = 10
/** 抜き出した文の最大の長さ */
const MAX_QUOTE_LENGTH = 120
const MAX_QUOTES = 3
const MAX_COMPETITOR_NAMES = 2
/** 割合の引き算で出る誤差（0.3 − 0.1 = 0.19999…）を、境界の判定で吸収する */
const EPSILON = 1e-9

type Sentiment = 'positive' | 'neutral' | 'negative'

/** 回答 1 件。新しい順に並べて渡す */
export type HintResponse = {
  id: string
  promptId: string
  promptText: string
  /** アーカイブされていない（今も計測している）質問か */
  isPromptActive: boolean
  brandMentioned: boolean
  sentiment: Sentiment | null
  /** 否定的な回答のときだけ要る（文を抜き出すため） */
  answerText: string | null
  /** 名前が出た、登録した競合の ID */
  competitorIds: string[]
  /** 引用されたドメイン（重複なし） */
  citedDomains: string[]
}

export type HintInput = {
  brand: { name: string; aliases: string[]; domain: string | null }
  competitors: { id: string; name: string; domain: string | null }[]
  responses: HintResponse[]
  /** 毎日の計測で 1 日に集まる回答の数（自動計測が止まっていれば 0） */
  responsesPerDay: number
}

type HintBase = {
  priority: number
  /** 差を計算した母数（優先度に使う） */
  responses: number
}

export type SiteHint = HintBase & {
  kind: 'site'
  domain: string
  /** そのサイトを引用した回答で、よく名前が出た競合 */
  competitorNames: string[]
  /** 競合が出た回答のうち、そのサイトを引用した割合 */
  competitorRate: number
  /** 自社が出た回答のうち、そのサイトを引用した割合 */
  brandRate: number
  evidenceResponseIds: string[]
}

export type PromptHint = HintBase & {
  kind: 'prompt'
  promptId: string
  promptText: string
  competitorNames: string[]
  /** いちばん出ている競合の割合 */
  competitorRate: number
  brandRate: number
  evidenceResponseIds: string[]
}

export type NegativeHint = HintBase & {
  kind: 'negative'
  negativeResponses: number
  /** AI が自社について書いた文（そのまま） */
  quotes: string[]
  evidenceResponseIds: string[]
}

export type DomainCount = { domain: string; responses: number; isOwn: boolean }

export type OwnSiteHint = HintBase & {
  kind: 'ownSite'
  /** 未設定なら null（設定を促す） */
  domain: string | null
  ownRate: number | null
  topDomain: string
  topRate: number
  evidenceDomains: DomainCount[]
}

export type Hint = SiteHint | PromptHint | NegativeHint | OwnSiteHint
export type HintKind = Hint['kind']

/** 施策を見分けるキー（同じ種類の施策は、サイトや質問ごとに 1 つ） */
export function hintKey(hint: Hint): string {
  switch (hint.kind) {
    case 'site':
      return `site:${hint.domain}`
    case 'prompt':
      return `prompt:${hint.promptId}`
    case 'negative':
    case 'ownSite':
      return hint.kind
  }
}

export type HintsResult =
  | { status: 'waiting'; responses: number; needed: number; daysLeft: number | null }
  | { status: 'ready'; responses: number; hints: Hint[] }

/**
 * 優先度：差 × √(母数の回答数)。
 * 差が大きいほど、また回答が多い（たまたまではない）ほど上に来る。
 * √ にするのは、割合のぶれが回答数の √ に反比例して小さくなるため
 */
export function hintPriority({ responses, gap }: { responses: number; gap: number }): number {
  return gap * Math.sqrt(responses)
}

const meetsGap = (gap: number) => gap >= MIN_GAP - EPSILON

/** domain が site そのものか、そのサブドメインか */
function isSameSite(domain: string, site: string | null): boolean {
  return site !== null && (domain === site || domain.endsWith(`.${site}`))
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total
}

/** 回答の中で名前がよく出た競合を、多い順に（同数なら登録順） */
function topCompetitorNames(input: HintInput, responses: HintResponse[]): string[] {
  return input.competitors
    .map((c, order) => ({
      name: c.name,
      order,
      count: responses.filter((r) => r.competitorIds.includes(c.id)).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, MAX_COMPETITOR_NAMES)
    .map((c) => c.name)
}

function evidenceIds(responses: HintResponse[]): string[] {
  return responses.slice(0, EVIDENCE_LIMIT).map((r) => r.id)
}

/** 回答ごとのドメインを、引用した回答の数で数える（多い順・同数なら名前順） */
function countDomains(responses: HintResponse[]): { domain: string; responses: number }[] {
  const counts = new Map<string, number>()
  for (const r of responses) {
    for (const d of new Set(r.citedDomains)) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return [...counts]
    .map(([domain, n]) => ({ domain, responses: n }))
    .sort((a, b) => b.responses - a.responses || a.domain.localeCompare(b.domain))
}

function findSiteHints(input: HintInput): SiteHint[] {
  const withCompetitor = input.responses.filter((r) => r.competitorIds.length > 0)
  const withBrand = input.responses.filter((r) => r.brandMentioned)
  if (withCompetitor.length < MIN_GROUP_RESPONSES) return []
  const excluded = [input.brand.domain, ...input.competitors.map((c) => c.domain)]

  return countDomains(withCompetitor).flatMap(({ domain, responses: count }) => {
    if (count < MIN_SITE_CITATIONS) return []
    if (excluded.some((site) => isSameSite(domain, site))) return []
    const citing = withCompetitor.filter((r) => r.citedDomains.includes(domain))
    const competitorRate = rate(count, withCompetitor.length)
    const brandRate = rate(
      withBrand.filter((r) => r.citedDomains.includes(domain)).length,
      withBrand.length,
    )
    const gap = competitorRate - brandRate
    if (!meetsGap(gap)) return []
    return [
      {
        kind: 'site' as const,
        domain,
        competitorNames: topCompetitorNames(input, citing),
        competitorRate,
        brandRate,
        responses: withCompetitor.length,
        priority: hintPriority({ responses: withCompetitor.length, gap }),
        evidenceResponseIds: evidenceIds(citing),
      },
    ]
  })
}

function groupByPrompt(responses: HintResponse[]): HintResponse[][] {
  const groups = new Map<string, HintResponse[]>()
  for (const r of responses) groups.set(r.promptId, [...(groups.get(r.promptId) ?? []), r])
  return [...groups.values()]
}

function findPromptHints(input: HintInput): PromptHint[] {
  const active = input.responses.filter((r) => r.isPromptActive)
  return groupByPrompt(active).flatMap((group) => {
    const first = group[0]
    if (!first || group.length < MIN_GROUP_RESPONSES) return []
    const competitorRate = Math.max(
      0,
      ...input.competitors.map((c) =>
        rate(group.filter((r) => r.competitorIds.includes(c.id)).length, group.length),
      ),
    )
    const brandRate = rate(group.filter((r) => r.brandMentioned).length, group.length)
    const gap = competitorRate - brandRate
    if (!meetsGap(gap)) return []
    return [
      {
        kind: 'prompt' as const,
        promptId: first.promptId,
        promptText: first.promptText,
        competitorNames: topCompetitorNames(input, group),
        competitorRate,
        brandRate,
        responses: group.length,
        priority: hintPriority({ responses: group.length, gap }),
        evidenceResponseIds: evidenceIds(group),
      },
    ]
  })
}

function findNegativeHints(input: HintInput): NegativeHint[] {
  const withBrand = input.responses.filter((r) => r.brandMentioned)
  const negatives = withBrand.filter((r) => r.sentiment === 'negative')
  if (negatives.length < MIN_NEGATIVE_RESPONSES) return []
  const names = [input.brand.name, ...input.brand.aliases]
  const quotes = [
    ...new Set(negatives.flatMap((r) => sentencesMentioning(r.answerText ?? '', names))),
  ].slice(0, MAX_QUOTES)
  return [
    {
      kind: 'negative',
      negativeResponses: negatives.length,
      quotes,
      responses: withBrand.length,
      priority: hintPriority({
        responses: withBrand.length,
        gap: rate(negatives.length, withBrand.length),
      }),
      evidenceResponseIds: evidenceIds(negatives),
    },
  ]
}

function findOwnSiteHints(input: HintInput): OwnSiteHint[] {
  const cited = input.responses.filter((r) => r.citedDomains.length > 0)
  if (cited.length < MIN_GROUP_RESPONSES) return []
  const own = input.brand.domain
  const domains = countDomains(cited).map((d) => ({ ...d, isOwn: isSameSite(d.domain, own) }))
  const top = domains.find((d) => !d.isOwn)
  if (!top) return []
  const topRate = rate(top.responses, cited.length)
  const ownRate =
    own === null
      ? null
      : rate(
          cited.filter((r) => r.citedDomains.some((d) => isSameSite(d, own))).length,
          cited.length,
        )
  if (ownRate !== null && ownRate >= OWN_SITE_RARE_RATE - EPSILON) return []
  return [
    {
      kind: 'ownSite',
      domain: own,
      ownRate,
      topDomain: top.domain,
      topRate,
      responses: cited.length,
      priority: hintPriority({
        responses: cited.length,
        gap: Math.max(0, topRate - (ownRate ?? 0)),
      }),
      evidenceDomains: domains.slice(0, EVIDENCE_LIMIT),
    },
  ]
}

/** 優先度の高い順に、1 種類 MAX_HINTS_PER_KIND 件まで・全部で MAX_HINTS 件まで */
function pickTop(candidates: Hint[]): Hint[] {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority)
  const picked: Hint[] = []
  for (const hint of sorted) {
    if (picked.length >= MAX_HINTS) break
    if (picked.filter((h) => h.kind === hint.kind).length >= MAX_HINTS_PER_KIND) continue
    picked.push(hint)
  }
  return picked
}

export function buildHints(input: HintInput): HintsResult {
  const total = input.responses.length
  if (total < MIN_RESPONSES) {
    return {
      status: 'waiting',
      responses: total,
      needed: MIN_RESPONSES,
      daysLeft:
        input.responsesPerDay > 0
          ? Math.ceil((MIN_RESPONSES - total) / input.responsesPerDay)
          : null,
    }
  }
  const candidates: Hint[] = [
    ...findSiteHints(input),
    ...findPromptHints(input),
    ...findNegativeHints(input),
    ...findOwnSiteHints(input),
  ]
  return { status: 'ready', responses: total, hints: pickTop(candidates) }
}

/** 箇条書きの記号（「- 」「1. 」「・」など）を文頭から外す */
const LIST_MARKER = /^(?:[-*・•]|\d+[.)．])\s*/

/** 文の終わり（。！？!?）か改行で区切る */
function splitSentences(text: string): string[] {
  return text
    .split(/\n|(?<=[。！？!?])/)
    .map((s) => s.trim().replace(LIST_MARKER, '').replace(/\*\*/g, '').trim())
    .filter((s) => s.length > 0)
}

function truncate(sentence: string): string {
  return sentence.length > MAX_QUOTE_LENGTH ? `${sentence.slice(0, MAX_QUOTE_LENGTH)}…` : sentence
}

/** 名前（表記ゆれ・別名を含む）が出てくる文を、出てきた順に重複なく返す */
export function sentencesMentioning(text: string, names: string[]): string[] {
  const needles = names.map(normalize).filter((n) => n.length > 0)
  const found = splitSentences(text).filter((s) => {
    const haystack = normalize(s)
    return needles.some((n) => haystack.includes(n))
  })
  return [...new Set(found)].map(truncate)
}
