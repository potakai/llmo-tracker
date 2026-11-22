/**
 * アプリ本体のテーブル。
 * 設計書: 「AI検索モニター 設計書（v1）」のテーブル定義と同じ並び。
 *
 * - DBのカラム名は snake_case（drizzle の casing 設定で自動変換）、TS側は camelCase
 * - id は uuid 型で、中身は UUIDv7（時刻順に並ぶので、作成順のソートやインデックスと相性がいい）
 * - テナントの境界は brand.organizationId。それより下のテーブルは brand をたどって組織に届く
 */
import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'
import { organization } from './auth'

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7())

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

// ---------------------------------------------------------------------------
// enum
// ---------------------------------------------------------------------------

/** 対象のAI。追加するときはここに値を足し、取得処理に実装を1つ足す */
export const providerEnum = pgEnum('provider', ['openai', 'gemini'])
export const runTriggerEnum = pgEnum('run_trigger', ['scheduled', 'manual'])
/** partial = 一部の回答だけ失敗した。cancelled = 動かす前に取り消した（理由は run.cancelReason） */
export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
])
/** run を取り消した理由。schedule_disabled = 配信する前に、ブランドの自動計測がオフになった */
export const runCancelReasonEnum = pgEnum('run_cancel_reason', ['schedule_disabled'])
export const resultStatusEnum = pgEnum('result_status', ['succeeded', 'failed'])
export const sentimentEnum = pgEnum('sentiment', ['positive', 'neutral', 'negative'])
/** unknown = まだ登録されていない会社・サービス */
export const entityTypeEnum = pgEnum('entity_type', ['brand', 'competitor', 'unknown'])
/** 質問の聞き方。question = 質問文（「〜はどこ？」）、keyword = 検索のように単語を並べたもの */
export const promptKindEnum = pgEnum('prompt_kind', ['question', 'keyword'])

/** Google の検索結果（DataForSEO）を、本物で取ったか（live）フェイクで作ったか（fake） */
export const serpModeEnum = pgEnum('serp_mode', ['live', 'fake'])
/** pending = 検索を頼んで、結果を待っている（または頼む前） */
export const serpStatusEnum = pgEnum('serp_status', ['pending', 'succeeded', 'failed'])

export const PROVIDERS = providerEnum.enumValues
export type Provider = (typeof PROVIDERS)[number]
export const PROMPT_KINDS = promptKindEnum.enumValues
export type PromptKind = (typeof PROMPT_KINDS)[number]
export type SerpMode = (typeof serpModeEnum.enumValues)[number]

// ---------------------------------------------------------------------------
// brand: 計測するブランド
// ---------------------------------------------------------------------------

export const brand = pgTable(
  'brand',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** 表記ゆれ（英語名、略称など） */
    aliases: text().array().notNull().default(sql`'{}'::text[]`),
    /** 引用URLが自社サイトかどうかの判定に使う */
    domain: text(),
    /** 1回の実行で同じ質問を何回聞くか */
    samplesPerPrompt: smallint().notNull().default(5),
    providers: providerEnum().array().notNull().default(sql`'{openai,gemini}'::provider[]`),
    scheduleEnabled: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('brand_organization_id_idx').on(t.organizationId),
    check('brand_samples_per_prompt_range', sql`${t.samplesPerPrompt} between 1 and 10`),
    check('brand_providers_not_empty', sql`cardinality(${t.providers}) > 0`),
  ],
)

// ---------------------------------------------------------------------------
// competitor: 競合
// ---------------------------------------------------------------------------

export const competitor = pgTable(
  'competitor',
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brand.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    aliases: text().array().notNull().default(sql`'{}'::text[]`),
    domain: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('competitor_brand_id_name_uq').on(t.brandId, t.name)],
)

// ---------------------------------------------------------------------------
// prompt: AIに投げる質問文
// 過去の回答を残すため物理削除しない（archivedAt を入れる）。
// 有効な質問は1ブランド10件まで。上限はアプリ側で検証する。
// ---------------------------------------------------------------------------

export const prompt = pgTable(
  'prompt',
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brand.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    /** 聞き方の種類。文面と違って、あとから変えてもよい（過去の回答の意味は変わらない） */
    kind: promptKindEnum().notNull().default('question'),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('prompt_brand_id_idx').on(t.brandId),
    check('prompt_text_length', sql`char_length(${t.text}) between 1 and 500`),
  ],
)

// ---------------------------------------------------------------------------
// run: 実行バッチ（自動 or 手動の1回分）
// ---------------------------------------------------------------------------

export const run = pgTable(
  'run',
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brand.id, { onDelete: 'cascade' }),
    trigger: runTriggerEnum().notNull(),
    status: runStatusEnum().notNull().default('queued'),
    /** 自動実行の対象日。手動実行では null */
    scheduledFor: date({ mode: 'string' }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    /** 取り消した理由（status = cancelled のときだけ入る） */
    cancelReason: runCancelReasonEnum(),
    totalCostUsd: numeric({ precision: 10, scale: 4, mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('run_brand_id_created_at_idx').on(t.brandId, t.createdAt),
    // 同じ日の自動実行が二重に走らないようにする（手動は scheduledFor が null なので対象外）
    uniqueIndex('run_brand_id_scheduled_for_uq').on(t.brandId, t.scheduledFor),
    // 1 ブランドで同時に動く run は 1 つまで（ボタン連打や自動・手動の重なりで二重に課金されない）
    uniqueIndex('run_one_active_per_brand_uq')
      .on(t.brandId)
      .where(sql`${t.status} in ('queued', 'running')`),
    check(
      'run_scheduled_for_matches_trigger',
      sql`(${t.trigger} = 'scheduled') = (${t.scheduledFor} is not null)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// response: AIの回答（1回の質問 = 1行）
// ---------------------------------------------------------------------------

export const response = pgTable(
  'response',
  {
    id: id(),
    runId: uuid()
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    promptId: uuid()
      .notNull()
      .references(() => prompt.id, { onDelete: 'cascade' }),
    provider: providerEnum().notNull(),
    model: text().notNull(),
    /** 何回目の質問か（0始まり） */
    sampleIndex: smallint().notNull(),
    status: resultStatusEnum().notNull(),
    answerText: text(),
    error: text(),
    latencyMs: integer(),
    inputTokens: integer(),
    outputTokens: integer(),
    /** Web 検索が何回走ったか（費用の計算に使う）。保存を始める前の回答は null */
    searchCount: integer(),
    costUsd: numeric({ precision: 10, scale: 6, mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    // ジョブがリトライされても同じ回答が二重に入らない
    uniqueIndex('response_run_prompt_provider_sample_uq').on(
      t.runId,
      t.promptId,
      t.provider,
      t.sampleIndex,
    ),
    index('response_prompt_id_created_at_idx').on(t.promptId, t.createdAt),
    // 当月のアプリ全体の検索の回数を数える（Gemini の検索の無料枠の見積もり）
    index('response_provider_created_at_idx').on(t.provider, t.createdAt),
    check('response_sample_index_non_negative', sql`${t.sampleIndex} >= 0`),
    check('response_search_count_non_negative', sql`${t.searchCount} >= 0`),
    check(
      'response_status_payload',
      sql`(${t.status} = 'succeeded' and ${t.answerText} is not null) or (${t.status} = 'failed' and ${t.error} is not null)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// citation: 引用URL（APIが返す引用情報から作る。LLMでは抽出しない）
// ---------------------------------------------------------------------------

export const citation = pgTable(
  'citation',
  {
    id: id(),
    responseId: uuid()
      .notNull()
      .references(() => response.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    domain: text().notNull(),
    title: text(),
    /** 回答内での順番（0始まり） */
    position: smallint().notNull(),
    isOwnDomain: boolean().notNull().default(false),
  },
  (t) => [
    index('citation_response_id_idx').on(t.responseId),
    index('citation_domain_idx').on(t.domain),
  ],
)

// ---------------------------------------------------------------------------
// analysis: 回答の抽出結果（response と 1対1）
// 生の回答と解釈を分けておくと、抽出ロジックを直したときに
// APIを叩き直さずに過去の回答を再分析できる（schemaVersion で管理）。
// ---------------------------------------------------------------------------

export const analysis = pgTable('analysis', {
  responseId: uuid()
    .primaryKey()
    .references(() => response.id, { onDelete: 'cascade' }),
  status: resultStatusEnum().notNull(),
  brandMentioned: boolean(),
  /** 自社が何番目に出たか（1始まり）。出ていなければ null */
  brandRank: smallint(),
  sentiment: sentimentEnum(),
  extractorModel: text().notNull(),
  schemaVersion: smallint().notNull(),
  /** Zod で検証した抽出結果そのまま */
  raw: jsonb(),
  createdAt: createdAt(),
})

// ---------------------------------------------------------------------------
// mention: 回答に出てきた名前
// ---------------------------------------------------------------------------

export const mention = pgTable(
  'mention',
  {
    id: id(),
    responseId: uuid()
      .notNull()
      .references(() => response.id, { onDelete: 'cascade' }),
    entityType: entityTypeEnum().notNull(),
    competitorId: uuid().references(() => competitor.id, { onDelete: 'set null' }),
    /** 回答中の表記 */
    name: text().notNull(),
    /** 登場順（1始まり） */
    rank: smallint().notNull(),
  },
  (t) => [
    index('mention_response_id_idx').on(t.responseId),
    index('mention_competitor_id_idx').on(t.competitorId),
    // competitor を削除したら set null になるので、「competitor なら competitorId 必須」は制約にしない
    check(
      'mention_competitor_only',
      sql`${t.entityType} = 'competitor' or ${t.competitorId} is null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// serp_result: キーワードの質問を Google で検索した結果（1 キーワード 1 日 1 行）
// DataForSEO に検索を頼み（task_post）、数分後に結果を取りに行く（task_get）。
// (prompt_id, searched_on) を一意にして、同じキーワードを同じ日に 2 回頼まない（二重に課金しない）。
// ---------------------------------------------------------------------------

export const serpResult = pgTable(
  'serp_result',
  {
    id: id(),
    promptId: uuid()
      .notNull()
      .references(() => prompt.id, { onDelete: 'cascade' }),
    /** 何日分の検索か（日本時間の日付） */
    searchedOn: date({ mode: 'string' }).notNull(),
    mode: serpModeEnum().notNull(),
    status: serpStatusEnum().notNull().default('pending'),
    /** DataForSEO の task ID。頼んだらすぐ保存し、やり直しのときはこれで結果を取りに行く */
    taskId: text(),
    /**
     * 検索を頼み始めた時刻。task ID がないままこれが入っている行は、頼んだかどうか分からないので
     * 頼み直さない（二重に課金しない）
     */
    postAttemptedAt: timestamp({ withTimezone: true }),
    postedAt: timestamp({ withTimezone: true }),
    fetchedAt: timestamp({ withTimezone: true }),
    error: text(),
    /** API が返した費用（USD） */
    costUsd: numeric({ precision: 10, scale: 6, mode: 'number' }),
    /** AI による概要が出たか（結果が出るまでは null） */
    aiOverviewPresent: boolean(),
    /** あとから読み込まれる AI による概要だったか */
    aiOverviewAsynchronous: boolean(),
    aiOverviewText: text(),
    /** AI による概要から名前を抜き出した方法（モデル名、または rule-based） */
    extractorModel: text(),
    /** API が返した結果そのまま（あとで検証できるように残す） */
    raw: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('serp_result_prompt_id_searched_on_uq').on(t.promptId, t.searchedOn),
    index('serp_result_searched_on_status_idx').on(t.searchedOn, t.status),
    check(
      'serp_result_status_payload',
      sql`${t.status} = 'pending' or (${t.status} = 'succeeded' and ${t.aiOverviewPresent} is not null) or (${t.status} = 'failed' and ${t.error} is not null)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// serp_entity: 検索結果での自社・競合の扱い（serp_result 1 行につき、自社と競合ごとに 1 行）
// 順位は brand.domain / competitor.domain で照合し、AI による概要の名前は抽出器で判定する。
// ---------------------------------------------------------------------------

export const serpEntity = pgTable(
  'serp_entity',
  {
    id: id(),
    serpResultId: uuid()
      .notNull()
      .references(() => serpResult.id, { onDelete: 'cascade' }),
    entityType: entityTypeEnum().notNull(),
    competitorId: uuid().references(() => competitor.id, { onDelete: 'cascade' }),
    /** 自然検索の順位（1 始まり）。上位 10 件になければ null */
    organicRank: smallint(),
    organicUrl: text(),
    /** AI による概要に名前が出たか。AI による概要が出なければ null */
    aiOverviewMentioned: boolean(),
  },
  (t) => [
    index('serp_entity_serp_result_id_idx').on(t.serpResultId),
    check(
      'serp_entity_type',
      sql`(${t.entityType} = 'brand' and ${t.competitorId} is null) or (${t.entityType} = 'competitor' and ${t.competitorId} is not null)`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// serp_ai_overview_reference: AI による概要の引用元
// ---------------------------------------------------------------------------

export const serpAiOverviewReference = pgTable(
  'serp_ai_overview_reference',
  {
    id: id(),
    serpResultId: uuid()
      .notNull()
      .references(() => serpResult.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    domain: text().notNull(),
    title: text(),
    /** 引用元の順番（0 始まり） */
    position: smallint().notNull(),
    isOwnDomain: boolean().notNull().default(false),
  },
  (t) => [index('serp_ai_overview_reference_serp_result_id_idx').on(t.serpResultId)],
)

// ---------------------------------------------------------------------------
// relations（db.query.* でネストして取るため）
// ---------------------------------------------------------------------------

export const brandRelations = relations(brand, ({ one, many }) => ({
  organization: one(organization, {
    fields: [brand.organizationId],
    references: [organization.id],
  }),
  competitors: many(competitor),
  prompts: many(prompt),
  runs: many(run),
}))

export const competitorRelations = relations(competitor, ({ one, many }) => ({
  brand: one(brand, { fields: [competitor.brandId], references: [brand.id] }),
  mentions: many(mention),
}))

export const promptRelations = relations(prompt, ({ one, many }) => ({
  brand: one(brand, { fields: [prompt.brandId], references: [brand.id] }),
  responses: many(response),
  serpResults: many(serpResult),
}))

export const serpResultRelations = relations(serpResult, ({ one, many }) => ({
  prompt: one(prompt, { fields: [serpResult.promptId], references: [prompt.id] }),
  entities: many(serpEntity),
  references: many(serpAiOverviewReference),
}))

export const serpEntityRelations = relations(serpEntity, ({ one }) => ({
  serpResult: one(serpResult, { fields: [serpEntity.serpResultId], references: [serpResult.id] }),
  competitor: one(competitor, { fields: [serpEntity.competitorId], references: [competitor.id] }),
}))

export const serpAiOverviewReferenceRelations = relations(serpAiOverviewReference, ({ one }) => ({
  serpResult: one(serpResult, {
    fields: [serpAiOverviewReference.serpResultId],
    references: [serpResult.id],
  }),
}))

export const runRelations = relations(run, ({ one, many }) => ({
  brand: one(brand, { fields: [run.brandId], references: [brand.id] }),
  responses: many(response),
}))

export const responseRelations = relations(response, ({ one, many }) => ({
  run: one(run, { fields: [response.runId], references: [run.id] }),
  prompt: one(prompt, { fields: [response.promptId], references: [prompt.id] }),
  citations: many(citation),
  analysis: one(analysis),
  mentions: many(mention),
}))

export const citationRelations = relations(citation, ({ one }) => ({
  response: one(response, { fields: [citation.responseId], references: [response.id] }),
}))

export const analysisRelations = relations(analysis, ({ one }) => ({
  response: one(response, { fields: [analysis.responseId], references: [response.id] }),
}))

export const mentionRelations = relations(mention, ({ one }) => ({
  response: one(response, { fields: [mention.responseId], references: [response.id] }),
  competitor: one(competitor, { fields: [mention.competitorId], references: [competitor.id] }),
}))

// ---------------------------------------------------------------------------
// 型（アプリ側で使う）
// ---------------------------------------------------------------------------

export type Brand = typeof brand.$inferSelect
export type NewBrand = typeof brand.$inferInsert
export type Competitor = typeof competitor.$inferSelect
export type Prompt = typeof prompt.$inferSelect
export type Run = typeof run.$inferSelect
export type Response = typeof response.$inferSelect
export type Citation = typeof citation.$inferSelect
export type Analysis = typeof analysis.$inferSelect
export type Mention = typeof mention.$inferSelect
export type SerpResult = typeof serpResult.$inferSelect
export type SerpEntity = typeof serpEntity.$inferSelect
