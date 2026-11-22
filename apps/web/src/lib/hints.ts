/**
 * 改善のヒント：直近の回答から、クライアントが次にやることを機械的に見つける。
 * DB には触らない（集めた回答を渡すと、施策の一覧を返す）。しきい値と優先度の計算はここに集める。
 */
import { findNegativePassage, type NegativePassage } from './hint-quotes'

/** 何日分の回答から見つけるか */
export const HINT_WINDOW_DAYS = 14
/** これより回答が少ないときは、施策を出さない（少ないデータで断定しない） */
export const MIN_RESPONSES = 50
/** 割合を比べる母数（質問への回答・引用のある回答・自社の名前が出た回答など）の最小 */
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
/** 気になる点として見せる箇所の数 */
const MAX_PASSAGES = 3
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
  collection: CollectionSettings
}

/** 今の計測の設定（あと何日でデータが集まるかの見積もりに使う） */
export type CollectionSettings = {
  scheduleEnabled: boolean
  /** 今も計測している質問の数 */
  activePrompts: number
  /** 毎日の自動計測で 1 日に集まる回答の数（質問の数 × AI の数 × 回数） */
  responsesPerDay: number
}

/** データが集まるまでの見積もり */
export type WaitEstimate =
  | { kind: 'days'; daysLeft: number }
  /** 今の設定では、直近 HINT_WINDOW_DAYS 日の範囲に MIN_RESPONSES 件が届かない */
  | { kind: 'unreachable'; responsesPerDay: number }
  | { kind: 'noActivePrompts' }
  | { kind: 'scheduleOff' }

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
  /**
   * 自社が出た回答のうち、そのサイトを引用した割合。
   * 自社が出た回答が MIN_GROUP_RESPONSES 件に届かないときは比べられないので null
   */
  brandRate: number | null
  /** 自社の名前が出た回答の数 */
  brandResponses: number
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
  /** 自社について否定的に書いている箇所（前後の文つき） */
  passages: NegativePassage[]
  /** 否定的な箇所を言い回しから特定できなかった回答の数（回答全体を見てもらう） */
  unlocatedResponses: number
  evidenceResponseIds: string[]
}

export type DomainCount = { domain: string; responses: number; isOwn: boolean }

export type OwnSiteHint = HintBase & {
  kind: 'ownSite'
  domain: string
  /** 参考元が表示された回答（母数 = responses）のうち、自社サイトが入っていた割合 */
  ownRate: number
  /** 自社サイト以外でいちばん多く参考元になったサイト */
  topDomain: string
  topRate: number
  evidenceDomains: DomainCount[]
}

/** 自社サイトが未登録：引用の件数に関係なく、登録を案内する（いつも先頭に出す） */
export type OwnSiteSetupHint = HintBase & {
  kind: 'ownSiteSetup'
  evidenceDomains: DomainCount[]
}

export type Hint = SiteHint | PromptHint | NegativeHint | OwnSiteHint | OwnSiteSetupHint
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
    case 'ownSiteSetup':
      return hint.kind
  }
}

export type HintsResult =
  | { status: 'waiting'; responses: number; needed: number; estimate: WaitEstimate }
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
  // 自社が出た回答が少なければ比べない（競合側で参考元になっている割合だけで判断する）
  const isComparable = withBrand.length >= MIN_GROUP_RESPONSES
  const excluded = [input.brand.domain, ...input.competitors.map((c) => c.domain)]

  return countDomains(withCompetitor).flatMap(({ domain, responses: count }) => {
    if (count < MIN_SITE_CITATIONS) return []
    if (excluded.some((site) => isSameSite(domain, site))) return []
    const citing = withCompetitor.filter((r) => r.citedDomains.includes(domain))
    const competitorRate = rate(count, withCompetitor.length)
    const brandRate = isComparable
      ? rate(withBrand.filter((r) => r.citedDomains.includes(domain)).length, withBrand.length)
      : null
    const gap = competitorRate - (brandRate ?? 0)
    if (!meetsGap(gap)) return []
    return [
      {
        kind: 'site' as const,
        domain,
        competitorNames: topCompetitorNames(input, citing),
        competitorRate,
        brandRate,
        brandResponses: withBrand.length,
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
  const brandNames = [input.brand.name, ...input.brand.aliases]
  const otherNames = input.competitors.map((c) => c.name)
  const found = negatives.map((r) =>
    findNegativePassage(r.answerText ?? '', brandNames, otherNames),
  )
  const located = found.filter((p) => p !== null)
  // 箇所を特定できなかった回答は、回答全体を見てもらうので、根拠の先頭に並べる
  const unlocatedFirst = [
    ...negatives.filter((_, i) => found[i] === null),
    ...negatives.filter((_, i) => found[i] !== null),
  ]
  const passages = [...new Map(located.map((p) => [p.focus, p])).values()].slice(0, MAX_PASSAGES)
  return [
    {
      kind: 'negative',
      negativeResponses: negatives.length,
      passages,
      unlocatedResponses: found.length - located.length,
      responses: withBrand.length,
      priority: hintPriority({
        responses: withBrand.length,
        gap: rate(negatives.length, withBrand.length),
      }),
      evidenceResponseIds: evidenceIds(unlocatedFirst),
    },
  ]
}

function domainCounts(cited: HintResponse[], own: string | null): DomainCount[] {
  return countDomains(cited).map((d) => ({ ...d, isOwn: isSameSite(d.domain, own) }))
}

/** 自社サイトが未登録なら、引用の件数に関係なく登録を案内する */
function findOwnSiteSetupHint(input: HintInput): OwnSiteSetupHint | null {
  if (input.brand.domain !== null) return null
  const cited = input.responses.filter((r) => r.citedDomains.length > 0)
  const domains = domainCounts(cited, null)
  return {
    kind: 'ownSiteSetup',
    responses: cited.length,
    // 先頭に固定して出すので並べ替えには使わないが、ほかの施策と同じ式で参考の値を入れておく
    priority: hintPriority({
      responses: cited.length,
      gap: rate(domains[0]?.responses ?? 0, cited.length),
    }),
    evidenceDomains: domains.slice(0, EVIDENCE_LIMIT),
  }
}

function findOwnSiteHints(input: HintInput): OwnSiteHint[] {
  const own = input.brand.domain
  if (own === null) return []
  const cited = input.responses.filter((r) => r.citedDomains.length > 0)
  if (cited.length < MIN_GROUP_RESPONSES) return []
  const domains = domainCounts(cited, own)
  const top = domains.find((d) => !d.isOwn)
  if (!top) return []
  const topRate = rate(top.responses, cited.length)
  const ownRate = rate(
    cited.filter((r) => r.citedDomains.some((d) => isSameSite(d, own))).length,
    cited.length,
  )
  if (ownRate >= OWN_SITE_RARE_RATE - EPSILON) return []
  return [
    {
      kind: 'ownSite',
      domain: own,
      ownRate,
      topDomain: top.domain,
      topRate,
      responses: cited.length,
      priority: hintPriority({ responses: cited.length, gap: Math.max(0, topRate - ownRate) }),
      evidenceDomains: domains.slice(0, EVIDENCE_LIMIT),
    },
  ]
}

/** 優先度の高い順に、1 種類 MAX_HINTS_PER_KIND 件まで・全部で MAX_HINTS 件まで */
function pickTop(candidates: Hint[], limit: number): Hint[] {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority)
  const picked: Hint[] = []
  for (const hint of sorted) {
    if (picked.length >= limit) break
    if (picked.filter((h) => h.kind === hint.kind).length >= MAX_HINTS_PER_KIND) continue
    picked.push(hint)
  }
  return picked
}

/**
 * 今の計測の設定で、直近 HINT_WINDOW_DAYS 日の範囲に MIN_RESPONSES 件が集まるまでの日数を見積もる。
 * 古い回答は範囲から外れていくので、届くかどうかは「1 日の件数 × 日数」で決まる
 */
export function estimateWait(responses: number, collection: CollectionSettings): WaitEstimate {
  if (collection.activePrompts === 0) return { kind: 'noActivePrompts' }
  if (!collection.scheduleEnabled || collection.responsesPerDay <= 0) return { kind: 'scheduleOff' }
  const perDay = collection.responsesPerDay
  if (perDay * HINT_WINDOW_DAYS < MIN_RESPONSES) {
    return { kind: 'unreachable', responsesPerDay: perDay }
  }
  return { kind: 'days', daysLeft: Math.ceil((MIN_RESPONSES - responses) / perDay) }
}

export function buildHints(input: HintInput): HintsResult {
  const total = input.responses.length
  if (total < MIN_RESPONSES) {
    return {
      status: 'waiting',
      responses: total,
      needed: MIN_RESPONSES,
      estimate: estimateWait(total, input.collection),
    }
  }
  const setup = findOwnSiteSetupHint(input)
  const candidates: Hint[] = [
    ...findSiteHints(input),
    ...findPromptHints(input),
    ...findNegativeHints(input),
    ...findOwnSiteHints(input),
  ]
  const hints = setup
    ? [setup, ...pickTop(candidates, MAX_HINTS - 1)]
    : pickTop(candidates, MAX_HINTS)
  return { status: 'ready', responses: total, hints }
}
