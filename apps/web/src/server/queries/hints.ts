import { analysis, type Brand, citation, mention, prompt, response, run } from '@llmo/db'
import type { LlmMode } from '@llmo/llm'
import { and, desc, eq, gte, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  buildHints,
  type CollectionSettings,
  HINT_WINDOW_DAYS,
  type HintResponse,
  type HintsResult,
} from '@/lib/hints'
import { addDays, todayInTokyo } from '@/lib/stats'
import { promptOfResponse, runDate } from './metrics'
import { RESPONSE_VIEW_WITH } from './prompts'
import { countedResponses } from './sample-responses'
import { inOrganization } from './tenant'

/** このブランド（その組織のもの）の、since 以降に成功した回答 */
function hintScope(organizationId: string, brandId: string, llmMode: LlmMode, since: string): SQL {
  return and(
    eq(run.brandId, brandId),
    inOrganization(run.brandId, organizationId),
    eq(response.status, 'succeeded'),
    gte(runDate, since),
    countedResponses(llmMode),
  ) as SQL
}

/** 回答 ID ごとに値をまとめる（重複は除く） */
function groupValues(rows: { responseId: string; value: string }[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const { responseId, value } of rows) {
    const current = grouped.get(responseId) ?? []
    if (!current.includes(value)) grouped.set(responseId, [...current, value])
  }
  return grouped
}

/**
 * 施策を見つけるもとになる回答（新しい順）。出てきた競合と、引用されたドメインつき。
 * ブランドが organizationId の組織のものでなければ空。llmMode が live ならサンプルの AI の回答は入れない
 */
export async function loadHintResponses(
  organizationId: string,
  brandId: string,
  llmMode: LlmMode,
  since: string,
): Promise<HintResponse[]> {
  const scope = hintScope(organizationId, brandId, llmMode, since)
  const [rows, competitorRows, citationRows] = await Promise.all([
    db
      .select({
        id: response.id,
        promptId: response.promptId,
        promptText: prompt.text,
        date: runDate,
        isPromptActive: sql<boolean>`${prompt.archivedAt} is null`,
        brandMentioned: sql<boolean>`coalesce(${analysis.brandMentioned}, false)`,
        sentiment: analysis.sentiment,
        // 文を抜き出すのは否定的な回答だけなので、ほかの回答の本文は取らない
        answerText: sql<
          string | null
        >`case when ${analysis.sentiment} = 'negative' then ${response.answerText} end`,
      })
      .from(response)
      .innerJoin(run, eq(run.id, response.runId))
      .innerJoin(analysis, eq(analysis.responseId, response.id))
      .innerJoin(prompt, promptOfResponse)
      .where(scope)
      .orderBy(desc(response.createdAt), desc(response.sampleIndex)),
    db
      .select({ responseId: mention.responseId, value: sql<string>`${mention.competitorId}` })
      .from(mention)
      .innerJoin(response, eq(response.id, mention.responseId))
      .innerJoin(run, eq(run.id, response.runId))
      .where(and(scope, eq(mention.entityType, 'competitor'), isNotNull(mention.competitorId))),
    db
      .select({ responseId: citation.responseId, value: citation.domain })
      .from(citation)
      .innerJoin(response, eq(response.id, citation.responseId))
      .innerJoin(run, eq(run.id, response.runId))
      .where(scope),
  ])
  const competitors = groupValues(competitorRows)
  const domains = groupValues(citationRows)
  return rows.map((row) => ({
    ...row,
    competitorIds: competitors.get(row.id) ?? [],
    citedDomains: domains.get(row.id) ?? [],
  }))
}

/**
 * 根拠として見せる回答（新しい順）。このブランド（その組織のもの）の回答だけを返す。
 * llmMode が live ならサンプルの AI の回答は返さない
 */
export async function listEvidenceResponses(
  organizationId: string,
  brandId: string,
  llmMode: LlmMode,
  responseIds: string[],
) {
  if (responseIds.length === 0) return []
  return db.query.response.findMany({
    where: and(
      inArray(response.id, responseIds),
      inArray(
        response.runId,
        db
          .select({ id: run.id })
          .from(run)
          .where(and(eq(run.brandId, brandId), inOrganization(run.brandId, organizationId))),
      ),
      countedResponses(llmMode),
    ),
    orderBy: [desc(response.createdAt), desc(response.sampleIndex)],
    with: RESPONSE_VIEW_WITH,
  })
}

/** 施策を見つけるのに要るブランドの情報（findBrandInOrg の結果をそのまま渡せる） */
export type HintBrand = Pick<
  Brand,
  'id' | 'name' | 'aliases' | 'domain' | 'samplesPerPrompt' | 'providers' | 'scheduleEnabled'
> & {
  competitors: { id: string; name: string; domain: string | null }[]
  /** 今も計測している質問 */
  prompts: unknown[]
}

/** 今の計測の設定。1 日に集まる回答の数は、自動計測がオンかどうかに関係なく設定から計算する */
function collectionSettings(brand: HintBrand): CollectionSettings {
  return {
    scheduleEnabled: brand.scheduleEnabled,
    activePrompts: brand.prompts.length,
    responsesPerDay: brand.prompts.length * brand.providers.length * brand.samplesPerPrompt,
  }
}

/** 施策の一覧と、その根拠の回答 */
export async function getBrandHints(
  organizationId: string,
  brand: HintBrand,
  llmMode: LlmMode,
  options: { today?: string } = {},
) {
  const today = options.today ?? todayInTokyo()
  const since = addDays(today, -(HINT_WINDOW_DAYS - 1))
  const responses = await loadHintResponses(organizationId, brand.id, llmMode, since)
  const hints: HintsResult = buildHints({
    brand: { name: brand.name, aliases: brand.aliases, domain: brand.domain },
    competitors: brand.competitors.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
    responses,
    collection: collectionSettings(brand),
    today,
  })
  const evidenceIds =
    hints.status === 'ready'
      ? [
          ...new Set(
            hints.hints.flatMap((h) => ('evidenceResponseIds' in h ? h.evidenceResponseIds : [])),
          ),
        ]
      : []
  const evidence = await listEvidenceResponses(organizationId, brand.id, llmMode, evidenceIds)
  return { windowDays: HINT_WINDOW_DAYS, hints, evidence }
}

export type BrandHints = Awaited<ReturnType<typeof getBrandHints>>
