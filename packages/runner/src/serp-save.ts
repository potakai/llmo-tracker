import { type Db, serpAiOverviewReference, serpEntity, serpResult } from '@llmo/db'
import type { ExtractionResult, Extractor } from '@llmo/llm'
import type { OrganicResult, ParsedSerp } from '@llmo/serp'
import { and, eq } from 'drizzle-orm'
import { toCitations } from './execute-run'
import { isSameSite } from './site'

/** 検索結果を照らし合わせるブランドの情報 */
export type SerpBrand = {
  name: string
  aliases: string[]
  domain: string | null
  competitors: { id: string; name: string; aliases: string[]; domain: string | null }[]
}

/** そのドメインのサイトの、自然検索でいちばん上の順位。上位 10 件になければ null */
export function bestOrganicRank(
  organic: readonly OrganicResult[],
  domain: string | null,
): { rank: number; url: string } | null {
  if (!domain) return null
  const hits = organic.filter((o) => isSameSite(o.domain, domain))
  if (hits.length === 0) return null
  const best = hits.reduce((a, b) => (b.rank < a.rank ? b : a))
  return { rank: best.rank, url: best.url }
}

type EntityRow = {
  entityType: 'brand' | 'competitor'
  competitorId: string | null
  organicRank: number | null
  organicUrl: string | null
  aiOverviewMentioned: boolean | null
}

/**
 * 自社と競合ごとの、自然検索の順位と、AI による概要に名前が出たか。
 * 順位は brand.domain / competitor.domain で照合する（ドメインが未設定なら null）。
 * 名前は抽出器の結果で判定する（AI による概要が出なければ null）
 */
export function toEntityRows(
  serp: ParsedSerp,
  brand: SerpBrand,
  extraction: ExtractionResult | null,
): EntityRow[] {
  const mentioned = (competitorId: string | null) => {
    if (!extraction) return null
    return extraction.mentions.some((m) =>
      competitorId === null
        ? m.entityType === 'brand'
        : m.entityType === 'competitor' && m.competitorId === competitorId,
    )
  }
  const row = (
    entityType: EntityRow['entityType'],
    competitorId: string | null,
    domain: string | null,
  ): EntityRow => {
    const ranked = bestOrganicRank(serp.organic, domain)
    return {
      entityType,
      competitorId,
      organicRank: ranked?.rank ?? null,
      organicUrl: ranked?.url ?? null,
      aiOverviewMentioned: mentioned(competitorId),
    }
  }
  return [
    row('brand', null, brand.domain),
    ...brand.competitors.map((c) => row('competitor', c.id, c.domain)),
  ]
}

/** AI による概要の本文から、自社・競合の名前を抜き出す。AI による概要が出なければ抜き出さない */
export async function extractAiOverview(
  extractor: Extractor,
  serp: ParsedSerp,
  brand: SerpBrand,
  abortSignal?: AbortSignal,
): Promise<ExtractionResult | null> {
  if (!serp.aiOverview || serp.aiOverview.text.trim() === '') return null
  return extractor.extract({
    answerText: serp.aiOverview.text,
    brand: { name: brand.name, aliases: brand.aliases },
    competitors: brand.competitors.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })),
    abortSignal,
  })
}

/**
 * 取得した検索結果を保存する（まだ pending の行だけ。保存したら true）。
 * 自社・競合ごとの扱いと、AI による概要の引用元も入れ直す
 */
export async function saveSerpSuccess(
  db: Db,
  input: {
    serpResultId: string
    serp: ParsedSerp
    raw: unknown
    brand: SerpBrand
    extraction: ExtractionResult | null
  },
): Promise<boolean> {
  const { serp, brand, extraction } = input
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .update(serpResult)
      .set({
        status: 'succeeded',
        fetchedAt: new Date(),
        error: null,
        // 取れたので、前の障害のエラーは同じ更新の中で消す
        lastFetchError: null,
        lastFetchErrorAt: null,
        aiOverviewPresent: serp.aiOverview !== null,
        aiOverviewAsynchronous: serp.aiOverview?.asynchronous ?? null,
        aiOverviewText: serp.aiOverview?.text ?? null,
        extractorModel: extraction?.extractorModel ?? null,
        raw: input.raw ?? null,
      })
      .where(and(eq(serpResult.id, input.serpResultId), eq(serpResult.status, 'pending')))
      .returning({ id: serpResult.id })
    if (!saved) return false

    await tx.delete(serpEntity).where(eq(serpEntity.serpResultId, saved.id))
    await tx
      .insert(serpEntity)
      .values(toEntityRows(serp, brand, extraction).map((r) => ({ ...r, serpResultId: saved.id })))

    await tx
      .delete(serpAiOverviewReference)
      .where(eq(serpAiOverviewReference.serpResultId, saved.id))
    const references = toCitations(serp.aiOverview?.references ?? [], brand.domain)
    if (references.length > 0) {
      await tx
        .insert(serpAiOverviewReference)
        .values(references.map((r) => ({ ...r, serpResultId: saved.id })))
    }
    return true
  })
}
