import { analysis, prompt, response, run, type SerpMode, serpEntity, serpResult } from '@llmo/db'
import type { LlmMode } from '@llmo/llm'
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { addDays, todayInTokyo, wilsonInterval } from '@/lib/stats'
import { promptOfResponse, runDate } from './metrics'
import { countedResponses } from './sample-responses'
import { inOrganization } from './tenant'

/** Google の結果と AI の言及率を、直近何日分から出すか */
export const SERP_WINDOW_DAYS = 7

type Provider = 'openai' | 'gemini'

/** キーワード 1 つ分の、Google の検索の結果（直近でいちばん新しい日のもの） */
export type SerpRow = {
  searchedOn: string
  /** 自社の自然検索の順位。上位 10 件になければ null */
  brandRank: number | null
  /** 競合 ID ごとの順位 */
  competitorRanks: Record<string, number | null>
  aiOverviewPresent: boolean
  aiOverviewAsynchronous: boolean | null
  /** AI による概要に自社の名前が出たか（AI による概要が出なければ null） */
  brandInAiOverview: boolean | null
  /** AI による概要に名前が出た競合の ID */
  competitorsInAiOverview: string[]
}

export type SerpComparisonRow = {
  promptId: string
  text: string
  serp: SerpRow | null
  /** 直近の AI の回答で、自社の名前が出た割合（回答がなければ null） */
  ai: Record<Provider, { n: number; rate: number | null }>
}

/** ブランドのキーワードの質問（その組織のもの）。今も計測しているものだけ、登録順 */
async function keywordPromptsOf(organizationId: string, brandId: string) {
  return db
    .select({ id: prompt.id, text: prompt.text })
    .from(prompt)
    .where(
      and(
        eq(prompt.brandId, brandId),
        inOrganization(prompt.brandId, organizationId),
        eq(prompt.kind, 'keyword'),
        isNull(prompt.archivedAt),
      ),
    )
    .orderBy(asc(prompt.createdAt))
}

/**
 * キーワードごとの、直近でいちばん新しい日の検索の結果（取れたものだけ）。
 * serpMode が live なら、フェイクで作った結果は使わない
 */
async function latestSerpResults(
  organizationId: string,
  brandId: string,
  promptIds: string[],
  serpMode: SerpMode,
  since: string,
) {
  if (promptIds.length === 0) return []
  return db
    .selectDistinctOn([serpResult.promptId], {
      id: serpResult.id,
      promptId: serpResult.promptId,
      searchedOn: serpResult.searchedOn,
      aiOverviewPresent: serpResult.aiOverviewPresent,
      aiOverviewAsynchronous: serpResult.aiOverviewAsynchronous,
    })
    .from(serpResult)
    .innerJoin(prompt, eq(prompt.id, serpResult.promptId))
    .where(
      and(
        inArray(serpResult.promptId, promptIds),
        eq(prompt.brandId, brandId),
        inOrganization(prompt.brandId, organizationId),
        eq(serpResult.status, 'succeeded'),
        gte(serpResult.searchedOn, since),
        serpMode === 'live' ? eq(serpResult.mode, 'live') : undefined,
      ),
    )
    .orderBy(serpResult.promptId, desc(serpResult.searchedOn))
}

/** 検索の結果ごとの、自社・競合の扱い（その組織のブランドのものだけ） */
async function entitiesOf(organizationId: string, brandId: string, serpResultIds: string[]) {
  if (serpResultIds.length === 0) return []
  return db
    .select({
      serpResultId: serpEntity.serpResultId,
      entityType: serpEntity.entityType,
      competitorId: serpEntity.competitorId,
      organicRank: serpEntity.organicRank,
      aiOverviewMentioned: serpEntity.aiOverviewMentioned,
    })
    .from(serpEntity)
    .innerJoin(serpResult, eq(serpResult.id, serpEntity.serpResultId))
    .innerJoin(prompt, eq(prompt.id, serpResult.promptId))
    .where(
      and(
        inArray(serpEntity.serpResultId, serpResultIds),
        eq(prompt.brandId, brandId),
        inOrganization(prompt.brandId, organizationId),
      ),
    )
}

/** キーワードごと・AI ごとの、直近の回答の数と、自社の名前が出た数 */
async function aiMentionCounts(
  organizationId: string,
  brandId: string,
  promptIds: string[],
  llmMode: LlmMode,
  since: string,
) {
  if (promptIds.length === 0) return []
  return db
    .select({
      promptId: response.promptId,
      provider: response.provider,
      n: sql<number>`count(*)::int`,
      mentioned: sql<number>`count(*) filter (where ${analysis.brandMentioned})::int`,
    })
    .from(response)
    .innerJoin(run, eq(run.id, response.runId))
    .innerJoin(analysis, eq(analysis.responseId, response.id))
    .innerJoin(prompt, promptOfResponse)
    .where(
      and(
        eq(run.brandId, brandId),
        inOrganization(run.brandId, organizationId),
        inArray(response.promptId, promptIds),
        eq(response.status, 'succeeded'),
        gte(runDate, since),
        countedResponses(llmMode),
      ),
    )
    .groupBy(response.promptId, response.provider)
}

type EntityRow = Awaited<ReturnType<typeof entitiesOf>>[number]

function toSerpRow(
  result: Awaited<ReturnType<typeof latestSerpResults>>[number],
  entities: EntityRow[],
): SerpRow {
  const brand = entities.find((e) => e.entityType === 'brand')
  const competitors = entities.filter((e) => e.competitorId !== null)
  return {
    searchedOn: result.searchedOn,
    brandRank: brand?.organicRank ?? null,
    competitorRanks: Object.fromEntries(competitors.map((c) => [c.competitorId, c.organicRank])),
    aiOverviewPresent: result.aiOverviewPresent ?? false,
    aiOverviewAsynchronous: result.aiOverviewAsynchronous,
    brandInAiOverview: result.aiOverviewPresent ? (brand?.aiOverviewMentioned ?? false) : null,
    competitorsInAiOverview: competitors
      .filter((c) => c.aiOverviewMentioned)
      .map((c) => c.competitorId as string),
  }
}

/**
 * キーワードの質問ごとに、Google の検索順位・AI による概要・ChatGPT / Gemini の言及率を並べる。
 * ブランドが organizationId の組織のものでなければ空。
 * serpMode / llmMode が live なら、それぞれフェイクの結果は使わない
 */
export async function getSerpComparison(
  organizationId: string,
  brandId: string,
  modes: { serpMode: SerpMode; llmMode: LlmMode },
  options: { today?: string } = {},
): Promise<{ windowDays: number; rows: SerpComparisonRow[] }> {
  const today = options.today ?? todayInTokyo()
  const since = addDays(today, -(SERP_WINDOW_DAYS - 1))
  const prompts = await keywordPromptsOf(organizationId, brandId)
  const promptIds = prompts.map((p) => p.id)
  const [results, counts] = await Promise.all([
    latestSerpResults(organizationId, brandId, promptIds, modes.serpMode, since),
    aiMentionCounts(organizationId, brandId, promptIds, modes.llmMode, since),
  ])
  const entities = await entitiesOf(
    organizationId,
    brandId,
    results.map((r) => r.id),
  )

  const rows = prompts.map((p): SerpComparisonRow => {
    const result = results.find((r) => r.promptId === p.id)
    const ai = (provider: Provider) => {
      const row = counts.find((c) => c.promptId === p.id && c.provider === provider)
      const n = row?.n ?? 0
      return { n, rate: wilsonInterval(row?.mentioned ?? 0, n).rate }
    }
    return {
      promptId: p.id,
      text: p.text,
      serp: result
        ? toSerpRow(
            result,
            entities.filter((e) => e.serpResultId === result.id),
          )
        : null,
      ai: { openai: ai('openai'), gemini: ai('gemini') },
    }
  })
  return { windowDays: SERP_WINDOW_DAYS, rows }
}

export type SerpComparison = Awaited<ReturnType<typeof getSerpComparison>>
