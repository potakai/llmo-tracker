import { parseSerpResult } from './parse'
import type { FetchedTask, SerpFakeHints, SerpProvider } from './types'

/** フェイクの task ID の接頭辞（本物の ID は UUID） */
export const FAKE_TASK_PREFIX = 'fake-'

const ORGANIC_COUNT = 10
const FILLER_DOMAINS = [
  'hikaku-navi.example',
  'review-site.example',
  'matome-blog.example',
  'news-portal.example',
  'qa-community.example',
  'tech-media.example',
  'wiki-like.example',
  'ranking-guide.example',
  'price-check.example',
  'business-media.example',
]
/** 自社・競合が上位 10 件に入る割合 */
const RANKED_RATE = 0.6
/** AI による概要が出る割合と、そのうちあとから読み込まれる割合 */
const AI_OVERVIEW_RATE = 0.6
const ASYNC_RATE = 0.5
/** AI による概要の本文に、自社・競合の名前が出る割合 */
const NAMED_RATE = 0.5

/** 文字列から決まる乱数（同じ入力なら同じ結果） */
export function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Site = { domain: string; name: string }

/**
 * DataForSEO の task_get/advanced の result[0] と同じ形の、作り物の検索結果。
 * 自社・競合のドメインを混ぜて、AI による概要もときどき出す
 */
export function buildFakeSerpResult(
  keyword: string,
  hints: SerpFakeHints | undefined,
  seed: string,
) {
  const random = seededRandom(seed)
  const registered: Site[] = hints
    ? [hints.brand, ...hints.competitors].flatMap((s) =>
        s.domain ? [{ domain: s.domain, name: s.name }] : [],
      )
    : []
  const ranked = registered.filter(() => random() < RANKED_RATE)
  const sites = shuffle(
    [...ranked, ...FILLER_DOMAINS.map((domain) => ({ domain, name: domain }))],
    random,
  ).slice(0, ORGANIC_COUNT)

  const organic = sites.map((site, i) => ({
    type: 'organic',
    rank_group: i + 1,
    rank_absolute: i + 2,
    domain: `www.${site.domain}`,
    url: `https://www.${site.domain}/${encodeURIComponent(keyword)}`,
    title: `${site.name} | ${keyword}`,
  }))

  const items: unknown[] = [...organic]
  if (random() < AI_OVERVIEW_RATE) {
    const names = hints
      ? [hints.brand.name, ...hints.competitors.map((c) => c.name)].filter(
          () => random() < NAMED_RATE,
        )
      : []
    const body =
      names.length > 0
        ? `「${keyword}」では、${names.join('、')}がよく比べられます。`
        : `「${keyword}」は、目的や予算に合わせて選ぶのがよいでしょう。`
    const references = sites.slice(0, 3).map((site) => ({
      type: 'ai_overview_reference',
      source: site.name,
      domain: site.domain,
      url: `https://${site.domain}/guide`,
      title: `${site.name} のガイド`,
      text: body,
    }))
    items.unshift({
      type: 'ai_overview',
      rank_group: 1,
      rank_absolute: 1,
      asynchronous_ai_overview: random() < ASYNC_RATE,
      markdown: body,
      items: [{ type: 'ai_overview_element', title: null, text: body, markdown: body, references }],
      references: null,
    })
  }

  return {
    keyword,
    type: 'organic',
    se_domain: 'google.co.jp',
    location_code: 2392,
    language_code: 'ja',
    item_types: [...new Set(items.map((i) => (i as { type: string }).type))],
    items_count: items.length,
    items,
  }
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  return list
    .map((value) => ({ value, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ value }) => value)
}

/**
 * フェイクの DataForSEO。費用ゼロで、頼んだらすぐ結果が出る。
 * 結果は検索語と task ID から決まるので、同じタスクを取り直しても同じ結果になる
 */
export function createFakeSerpProvider(): SerpProvider {
  return {
    mode: 'fake',
    async postTask() {
      return { taskId: `${FAKE_TASK_PREFIX}${crypto.randomUUID()}`, costUsd: 0 }
    },
    async fetchTask({ taskId, keyword, fakeHints }): Promise<FetchedTask> {
      const raw = buildFakeSerpResult(keyword, fakeHints, `${keyword}:${taskId}`)
      return { status: 'ready', serp: parseSerpResult(raw), raw }
    },
  }
}
