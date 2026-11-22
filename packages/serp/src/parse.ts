import { z } from 'zod'
import type { AiOverview, AiOverviewReference, OrganicResult, ParsedSerp } from './types'

/**
 * task_get/advanced の結果（tasks[].result[0]）から、自然検索の順位と AI による概要を取り出す。
 * 外から来たデータなので、項目ごとに Zod で確かめ、形の合わない項目は読み飛ばす。
 * 形は https://docs.dataforseo.com/v3/serp/google/organic/task_get/advanced/ の
 * `organic` と `ai_overview`（`ai_overview_element` / `ai_overview_reference`）に合わせている
 */

const organicItemSchema = z.object({
  type: z.literal('organic'),
  rank_group: z.number().int().positive(),
  rank_absolute: z.number().int().positive(),
  domain: z.string().min(1),
  url: z.string().min(1),
  title: z.string().nullish(),
})

const referenceSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish(),
})

const aiOverviewElementSchema = z.object({
  title: z.string().nullish(),
  text: z.string().nullish(),
  markdown: z.string().nullish(),
  references: z.array(z.unknown()).nullish(),
})

const aiOverviewItemSchema = z.object({
  type: z.literal('ai_overview'),
  asynchronous_ai_overview: z.boolean().nullish(),
  markdown: z.string().nullish(),
  items: z.array(z.unknown()).nullish(),
  references: z.array(z.unknown()).nullish(),
})

const resultSchema = z.object({
  items: z.array(z.unknown()).nullish(),
})

export function parseSerpResult(result: unknown): ParsedSerp {
  const parsed = resultSchema.safeParse(result)
  const items = parsed.success ? (parsed.data.items ?? []) : []
  return {
    organic: parseOrganic(items),
    aiOverview: parseAiOverview(items),
  }
}

function parseOrganic(items: unknown[]): OrganicResult[] {
  return items.flatMap((item) => {
    const parsed = organicItemSchema.safeParse(item)
    if (!parsed.success) return []
    const o = parsed.data
    return [
      {
        rank: o.rank_group,
        rankAbsolute: o.rank_absolute,
        domain: o.domain.toLowerCase(),
        url: o.url,
        title: o.title ?? null,
      },
    ]
  })
}

/** 最初の ai_overview の項目を読む。なければ null */
function parseAiOverview(items: unknown[]): AiOverview | null {
  for (const item of items) {
    const parsed = aiOverviewItemSchema.safeParse(item)
    if (!parsed.success) continue
    const overview = parsed.data
    const elements = (overview.items ?? []).flatMap((e) => {
      const el = aiOverviewElementSchema.safeParse(e)
      return el.success ? [el.data] : []
    })
    const text =
      overview.markdown?.trim() ||
      elements
        .map((e) => e.markdown?.trim() || [e.title, e.text].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n\n')
    return {
      asynchronous: overview.asynchronous_ai_overview ?? false,
      text,
      // 要素ごとの引用元のあとに、項目全体の引用元を並べる（同じ URL は最初の 1 つだけ）
      references: uniqueReferences([
        ...elements.flatMap((e) => e.references ?? []),
        ...(overview.references ?? []),
      ]),
    }
  }
  return null
}

function uniqueReferences(raw: unknown[]): AiOverviewReference[] {
  const seen = new Set<string>()
  return raw.flatMap((r) => {
    const parsed = referenceSchema.safeParse(r)
    if (!parsed.success || seen.has(parsed.data.url)) return []
    seen.add(parsed.data.url)
    return [{ url: parsed.data.url, title: parsed.data.title ?? null }]
  })
}
