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
/** partial = 一部の回答だけ失敗した */
export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
])
export const resultStatusEnum = pgEnum('result_status', ['succeeded', 'failed'])
export const sentimentEnum = pgEnum('sentiment', ['positive', 'neutral', 'negative'])
/** unknown = まだ登録されていない会社・サービス */
export const entityTypeEnum = pgEnum('entity_type', ['brand', 'competitor', 'unknown'])

export const PROVIDERS = providerEnum.enumValues
export type Provider = (typeof PROVIDERS)[number]

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
    check('response_sample_index_non_negative', sql`${t.sampleIndex} >= 0`),
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
