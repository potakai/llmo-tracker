import { analysis, brand, citation, competitor, mention, prompt, response, run } from '@llmo/db'
import { and, asc, desc, eq, gte, type SQL, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { addDays, todayInTokyo, wilsonInterval } from '@/lib/stats'

/** run が「いつの計測か」：自動実行は対象日、手動実行は作成日（日本時間） */
const runDate = sql<string>`coalesce(${run.scheduledFor}, (${run.createdAt} at time zone 'Asia/Tokyo')::date)::text`

type Provider = 'openai' | 'gemini'
export type SeriesKey = Provider | 'all'

export type TrendPoint = {
  date: string
  /** その日までの直近 window 日に集めた回答数 */
  n: number
  rate: number | null
  low: number | null
  high: number | null
}

export type MetricsFilter = {
  /** 推移を何日分出すか */
  days?: number
  /** 何日分をまとめて 1 つの値にするか */
  window?: number
  /** 特定の AI だけ */
  provider?: Provider
  /** 特定の質問だけ */
  promptId?: string
  /** テスト用：今日の日付を固定する */
  today?: string
}

/**
 * ダッシュボードの数字をまとめて返す。絞り込み（AI・質問）はすべての数字に同じように効く。
 * - trend: 言及率の推移（日ごとに「直近 window 日分」をまとめた割合と 95% 信頼区間）
 * - shareOfVoice: 直近 window 日の、名前ごとの言及率（自社・競合・未登録）
 * - topDomains: 直近 window 日に引用されたドメインの上位
 * - byPrompt: 直近 window 日の、質問ごとの言及率
 */
export async function getBrandMetrics(brandId: string, filter: MetricsFilter = {}) {
  const days = filter.days ?? 30
  const window = filter.window ?? 7
  const today = filter.today ?? todayInTokyo()
  const from = addDays(today, -(days + window - 2)) // 最初の日にも window 日分の過去があるように
  const windowFrom = addDays(today, -(window - 1))

  const narrowing: SQL[] = []
  if (filter.provider) narrowing.push(eq(response.provider, filter.provider))
  if (filter.promptId) narrowing.push(eq(response.promptId, filter.promptId))

  const scope = (since: string) =>
    and(
      eq(run.brandId, brandId),
      eq(response.status, 'succeeded'),
      gte(runDate, since),
      ...narrowing,
    )

  // 1. 日ごと × AI ごとの「回答数」と「自社が出た数」
  const daily = await db
    .select({
      date: runDate,
      provider: response.provider,
      n: sql<number>`count(*)::int`,
      mentioned: sql<number>`count(*) filter (where ${analysis.brandMentioned})::int`,
    })
    .from(response)
    .innerJoin(run, eq(run.id, response.runId))
    .innerJoin(analysis, eq(analysis.responseId, response.id))
    .where(scope(from))
    .groupBy(runDate, response.provider)

  const byDay = new Map<string, Record<SeriesKey, { n: number; mentioned: number }>>()
  for (const row of daily) {
    const entry = byDay.get(row.date) ?? {
      openai: { n: 0, mentioned: 0 },
      gemini: { n: 0, mentioned: 0 },
      all: { n: 0, mentioned: 0 },
    }
    for (const key of [row.provider, 'all'] as const) {
      entry[key].n += row.n
      entry[key].mentioned += row.mentioned
    }
    byDay.set(row.date, entry)
  }

  const trend: Record<SeriesKey, TrendPoint[]> = { openai: [], gemini: [], all: [] }
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    for (const key of ['openai', 'gemini', 'all'] as const) {
      let n = 0
      let mentioned = 0
      for (let j = 0; j < window; j++) {
        const day = byDay.get(addDays(date, -j))?.[key]
        n += day?.n ?? 0
        mentioned += day?.mentioned ?? 0
      }
      trend[key].push({ date, n, ...wilsonInterval(mentioned, n) })
    }
  }

  // 2. 直近 window 日の、名前ごとの言及率（シェア・オブ・ボイス）
  const windowScope = scope(windowFrom)
  const [totals] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(response)
    .innerJoin(run, eq(run.id, response.runId))
    .innerJoin(analysis, eq(analysis.responseId, response.id))
    .where(windowScope)
  const windowTotal = totals?.n ?? 0

  const label = sql<string>`case
    when ${mention.entityType} = 'brand' then ${brand.name}
    when ${mention.entityType} = 'competitor' then coalesce(${competitor.name}, ${mention.name})
    else ${mention.name} end`
  const entities = await db
    .select({
      entityType: mention.entityType,
      name: label,
      responses: sql<number>`count(distinct ${mention.responseId})::int`,
      avgRank: sql<number>`round(avg(${mention.rank}), 1)::float`,
    })
    .from(mention)
    .innerJoin(response, eq(response.id, mention.responseId))
    .innerJoin(run, eq(run.id, response.runId))
    .innerJoin(brand, eq(brand.id, run.brandId))
    .leftJoin(competitor, eq(competitor.id, mention.competitorId))
    .where(windowScope)
    .groupBy(mention.entityType, label)
    .orderBy(desc(sql`count(distinct ${mention.responseId})`))
    .limit(12)

  const shareOfVoice = entities.map((e) => ({
    ...e,
    ...wilsonInterval(e.responses, windowTotal),
  }))

  // 3. 引用されたドメインの上位
  const topDomains = await db
    .select({
      domain: citation.domain,
      count: sql<number>`count(*)::int`,
      isOwnDomain: sql<boolean>`bool_or(${citation.isOwnDomain})`,
    })
    .from(citation)
    .innerJoin(response, eq(response.id, citation.responseId))
    .innerJoin(run, eq(run.id, response.runId))
    .where(windowScope)
    .groupBy(citation.domain)
    .orderBy(desc(sql`count(*)`))
    .limit(10)

  // 4. 質問ごとの言及率（AI ごとの内訳つき）
  const promptRows = await db
    .select({
      promptId: response.promptId,
      text: prompt.text,
      archived: sql<boolean>`${prompt.archivedAt} is not null`,
      provider: response.provider,
      n: sql<number>`count(*)::int`,
      mentioned: sql<number>`count(*) filter (where ${analysis.brandMentioned})::int`,
    })
    .from(response)
    .innerJoin(run, eq(run.id, response.runId))
    .innerJoin(analysis, eq(analysis.responseId, response.id))
    .innerJoin(prompt, eq(prompt.id, response.promptId))
    .where(windowScope)
    .groupBy(response.promptId, prompt.text, prompt.archivedAt, prompt.createdAt, response.provider)
    .orderBy(asc(prompt.createdAt))

  const promptMap = new Map<
    string,
    {
      promptId: string
      text: string
      archived: boolean
      counts: Record<SeriesKey, [number, number]>
    }
  >()
  for (const row of promptRows) {
    const entry = promptMap.get(row.promptId) ?? {
      promptId: row.promptId,
      text: row.text,
      archived: row.archived,
      counts: { openai: [0, 0], gemini: [0, 0], all: [0, 0] },
    }
    for (const key of [row.provider, 'all'] as const) {
      entry.counts[key][0] += row.mentioned
      entry.counts[key][1] += row.n
    }
    promptMap.set(row.promptId, entry)
  }
  const byPrompt = [...promptMap.values()].map(({ counts, ...rest }) => ({
    ...rest,
    n: counts.all[1],
    ...wilsonInterval(...counts.all),
    openai: wilsonInterval(...counts.openai).rate,
    gemini: wilsonInterval(...counts.gemini).rate,
  }))

  const latest = trend.all.at(-1) ?? null
  return {
    days,
    window,
    today,
    filter: { provider: filter.provider ?? null, promptId: filter.promptId ?? null },
    windowTotal,
    latest,
    trend,
    shareOfVoice,
    topDomains,
    byPrompt,
  }
}

export type BrandMetrics = Awaited<ReturnType<typeof getBrandMetrics>>
