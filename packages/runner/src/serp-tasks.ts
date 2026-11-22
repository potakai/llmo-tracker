import {
  brand as brandTable,
  competitor as competitorTable,
  type Db,
  prompt as promptTable,
  type SerpMode,
  serpResult,
} from '@llmo/db'
import type { Extractor } from '@llmo/llm'
import { type FetchedTask, SerpApiError, type SerpPolicy } from '@llmo/serp'
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm'
import { runUntilDeadline } from './deadline'
import { listScheduledBrands } from './scheduled-brands'
import { extractAiOverview, type SerpBrand, saveSerpSuccess } from './serp-save'

/** 1 回の DataForSEO の呼び出し・抽出の上限時間 */
const DEFAULT_SERP_TIMEOUT_MS = 60_000
const DEFAULT_SERP_CONCURRENCY = 4
const MAX_ERROR_LENGTH = 1000
/** 本物の DataForSEO の許可がなくなった live の行を終わらせるときの理由 */
const LIVE_REVOKED_BEFORE_POST =
  '本物の DataForSEO を使う許可がなくなったため、検索を頼まずに終わらせました'
const LIVE_REVOKED_BEFORE_FETCH =
  '本物の DataForSEO を使う許可がなくなったため、結果を取りに行かずに終わらせました'

export type SerpDeps = {
  db: Db
  /**
   * 組織ごとに本物の DataForSEO とフェイクを使い分ける。
   * modeFor は、頼む・取りに行く直前に「その組織が今も本物を使ってよいか」を確かめるのに使う
   * （行を作ったあとに SERP_MODE や LIVE_ORGANIZATION_IDS が変わっても、許可のない組織で本物を呼ばない）
   */
  serp: Pick<SerpPolicy, 'modeFor' | 'providerFor'>
  /** AI による概要から名前を抜き出す抽出器（組織ごと。AI の計測と同じもの） */
  extractorFor: (organizationId: string) => Extractor
  concurrency?: number
  timeoutMs?: number
}

export type SerpSliceOptions = {
  /** この時間（ミリ秒）を使い切ったら、新しい呼び出しを始めない（呼び出し途中のものは待つ） */
  budgetMs: number
  /** 指定すると、このキーワード（質問）の行だけを扱う（デモデータの作成用。ジョブでは指定しない） */
  promptIds?: readonly string[]
}

/** 対象をキーワードで絞る条件（指定がなければ絞らない） */
const onlyPrompts = (promptIds: readonly string[] | undefined) =>
  promptIds ? inArray(serpResult.promptId, [...promptIds]) : undefined

/** 頼む対象：キーワードの質問と、それを検索するモード */
export type SerpTarget = { promptId: string; mode: SerpMode }

/**
 * その日に Google で検索するキーワードの行を作る（status = pending）。
 * 対象は毎朝の AI の計測と同じ条件のブランド（listScheduledBrands）の、有効な「キーワード」の質問だけ。
 * (prompt_id, 日付) は一意なので、何度呼んでも 1 キーワード 1 日 1 行。作った行の数を返す
 */
export async function claimDailySerpTasks(
  db: Db,
  date: string,
  modeFor: (organizationId: string) => SerpMode,
): Promise<{ claimed: number }> {
  const isKeyword = eq(promptTable.kind, 'keyword')
  const brands = await listScheduledBrands(db, isKeyword)
  if (brands.length === 0) return { claimed: 0 }
  const modeOfBrand = new Map(brands.map((b) => [b.id, modeFor(b.organizationId)]))
  const prompts = await db
    .select({ id: promptTable.id, brandId: promptTable.brandId })
    .from(promptTable)
    .where(
      and(
        inArray(promptTable.brandId, [...modeOfBrand.keys()]),
        isNull(promptTable.archivedAt),
        isKeyword,
      ),
    )
  const targets = prompts.flatMap((p) => {
    const mode = modeOfBrand.get(p.brandId)
    return mode ? [{ promptId: p.id, mode }] : []
  })
  return claimSerpTasks(db, date, targets)
}

/** 指定したキーワードの、その日の行を作る（すでにあれば何もしない）。デモデータの作成でも使う */
export async function claimSerpTasks(
  db: Db,
  date: string,
  targets: readonly SerpTarget[],
): Promise<{ claimed: number }> {
  if (targets.length === 0) return { claimed: 0 }
  const rows = await db
    .insert(serpResult)
    .values(targets.map((t) => ({ promptId: t.promptId, searchedOn: date, mode: t.mode })))
    .onConflictDoNothing({ target: [serpResult.promptId, serpResult.searchedOn] })
    .returning({ id: serpResult.id })
  return { claimed: rows.length }
}

/**
 * その日のまだ頼んでいない行について、DataForSEO に検索を頼む（task_post）。
 * - 頼む直前に post_attempted_at を入れる（入っていない行だけ。1 つの UPDATE で確かめて入れる）。
 *   入っている行は二度と頼まない。頼んだあと task ID を保存する前に落ちても、二重に課金しない
 * - task ID は返ってきたらすぐ保存する。結果はあとで collectSerpResults が取りに行く
 * - 頼むのに失敗したら、そのキーワードだけ failed にして、ほかは続ける
 * 予算を使い切ったら残りの数を remaining で返す（もう一度呼べば続きから頼む）
 */
export async function postSerpTasks(
  deps: SerpDeps,
  date: string,
  options: SerpSliceOptions,
): Promise<{ posted: number; failed: number; remaining: number }> {
  const { db } = deps
  const deadline = Date.now() + options.budgetMs
  const rows = await db
    .select({
      id: serpResult.id,
      mode: serpResult.mode,
      keyword: promptTable.text,
      organizationId: brandTable.organizationId,
    })
    .from(serpResult)
    .innerJoin(promptTable, eq(promptTable.id, serpResult.promptId))
    .innerJoin(brandTable, eq(brandTable.id, promptTable.brandId))
    .where(
      and(
        eq(serpResult.searchedOn, date),
        eq(serpResult.status, 'pending'),
        isNull(serpResult.taskId),
        isNull(serpResult.postAttemptedAt),
        onlyPrompts(options.promptIds),
      ),
    )
    .orderBy(asc(serpResult.createdAt))

  const counts = { posted: 0, failed: 0 }
  const processed = await runUntilDeadline(
    rows,
    { concurrency: deps.concurrency ?? DEFAULT_SERP_CONCURRENCY, deadline },
    async (row) => {
      const [attempt] = await db
        .update(serpResult)
        .set({ postAttemptedAt: sql`now()` })
        .where(and(eq(serpResult.id, row.id), isNull(serpResult.postAttemptedAt)))
        .returning({ id: serpResult.id })
      // ほかの呼び出しが先に頼み始めた
      if (!attempt) return
      // 頼む直前に、今の許可を確かめる（row.mode だけで本物を選ばない）
      if (!isModeAllowed(deps, row)) {
        await markSerpFailed(db, row.id, LIVE_REVOKED_BEFORE_POST)
        counts.failed += 1
        return
      }
      try {
        const posted = await deps.serp.providerFor(row.mode).postTask({
          keyword: row.keyword,
          tag: row.id,
          abortSignal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_SERP_TIMEOUT_MS),
        })
        await db
          .update(serpResult)
          .set({ taskId: posted.taskId, postedAt: sql`now()`, costUsd: posted.costUsd })
          .where(eq(serpResult.id, row.id))
        counts.posted += 1
      } catch (error) {
        await markSerpFailed(db, row.id, `検索を頼めませんでした：${errorMessage(error)}`)
        counts.failed += 1
      }
    },
  )
  return { ...counts, remaining: rows.length - processed }
}

export type CollectOptions = SerpSliceOptions & {
  /**
   * カーソル：この ID より後の行だけを取りに行く（前の呼び出しが返した cursor を渡す）。
   * 1 回の取得ラウンドの中で、まだ結果が出ていない行ばかりを繰り返さず、全部の行を 1 回ずつ確かめるため
   */
  after?: string | null
}

export type CollectResult = {
  succeeded: number
  failed: number
  /** 取りに行ったが、まだ結果が出ていない数 */
  pending: number
  /** 予算を使い切って見送った数 */
  remaining: number
  /** 見送った分があれば、続きを取りに行くときに after に渡す値。なければ null */
  cursor: string | null
}

/**
 * その日の頼んである行について、結果を取りに行く（task_get）。
 * - まだ終わっていなければ pending のまま（あとでもう一度呼ぶ）
 * - 終わっていれば、順位と AI による概要を照らし合わせて保存する
 * - DataForSEO がタスクのエラーを返したら、そのキーワードだけ failed にする。
 *   通信のエラーなどは pending のまま（次に呼んだときに取り直す。結果の取得は無料）
 * 行は ID の順（作った順）に取りに行く。remaining が残っていれば、返した cursor を after に渡して呼ぶと続きから取りに行く
 */
export async function collectSerpResults(
  deps: SerpDeps,
  date: string,
  options: CollectOptions,
): Promise<CollectResult> {
  const { db } = deps
  const deadline = Date.now() + options.budgetMs
  const rows = await db
    .select({
      id: serpResult.id,
      mode: serpResult.mode,
      taskId: serpResult.taskId,
      keyword: promptTable.text,
      brandId: brandTable.id,
      organizationId: brandTable.organizationId,
      brandName: brandTable.name,
      brandAliases: brandTable.aliases,
      brandDomain: brandTable.domain,
    })
    .from(serpResult)
    .innerJoin(promptTable, eq(promptTable.id, serpResult.promptId))
    .innerJoin(brandTable, eq(brandTable.id, promptTable.brandId))
    .where(
      and(
        eq(serpResult.searchedOn, date),
        eq(serpResult.status, 'pending'),
        isNotNull(serpResult.taskId),
        onlyPrompts(options.promptIds),
        options.after ? gt(serpResult.id, options.after) : undefined,
      ),
    )
    .orderBy(asc(serpResult.id))
  const competitors = await competitorsOf(db, [...new Set(rows.map((r) => r.brandId))])

  const counts = { succeeded: 0, failed: 0, stillPending: 0 }
  const processed = await runUntilDeadline(
    rows,
    { concurrency: deps.concurrency ?? DEFAULT_SERP_CONCURRENCY, deadline },
    async (row) => {
      const brand: SerpBrand = {
        name: row.brandName,
        aliases: row.brandAliases,
        domain: row.brandDomain,
        competitors: competitors.get(row.brandId) ?? [],
      }
      const outcome = await collectOne(deps, row, brand)
      counts[outcome] += 1
    },
  )
  const remaining = rows.length - processed
  return {
    succeeded: counts.succeeded,
    failed: counts.failed,
    pending: counts.stillPending,
    remaining,
    // runUntilDeadline は先頭から順に始め、締め切りを過ぎたらそれ以降は始めないので、処理したのは先頭の processed 件
    cursor: remaining > 0 ? (rows[processed - 1]?.id ?? null) : null,
  }
}

/** ジョブのステップ（Inngest の step.run / step.sleep）。テストでは、その場で実行するものを渡す */
export type SerpJobSteps = {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>
  sleep(name: string): Promise<void>
}

/**
 * 待ってから結果を取りに行く、を未完了の行がなくなるまで（最大 maxRounds 回）繰り返す。
 * 1 回の取得ラウンドでは、カーソルを進めながら全部の行を 1 回ずつ確かめる（予算で区切っても同じ行を繰り返さない）。
 * 1 回の呼び出しで少なくとも 1 行は進むので、ラウンドは必ず終わり、上限の回数で必ず止まる。
 * 終わったラウンドの数と、最後のラウンドで結果が出ていなかった行の数を返す
 */
export async function waitAndCollectSerpResults(
  steps: SerpJobSteps,
  collect: (after: string | null) => Promise<CollectResult>,
  options: { maxRounds: number },
): Promise<{ rounds: number; pending: number }> {
  let pending = 0
  for (let round = 1; round <= options.maxRounds; round += 1) {
    await steps.sleep(`wait-${round}`)
    pending = 0
    let after: string | null = null
    for (let slice = 1; ; slice += 1) {
      const cursor: string | null = after
      const result: CollectResult = await steps.run(`collect-${round}-${slice}`, () =>
        collect(cursor),
      )
      pending += result.pending
      if (result.remaining === 0 || result.cursor === null) break
      after = result.cursor
    }
    if (pending === 0) return { rounds: round, pending }
  }
  return { rounds: options.maxRounds, pending }
}

type CollectRow = {
  id: string
  mode: SerpMode
  taskId: string | null
  keyword: string
  organizationId: string
}

async function collectOne(
  deps: SerpDeps,
  row: CollectRow,
  brand: SerpBrand,
): Promise<'succeeded' | 'failed' | 'stillPending'> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SERP_TIMEOUT_MS
  // 取りに行く直前に、今の許可を確かめる。許可がなければ、保存した本物の task ID はどこにも渡さない
  if (!isModeAllowed(deps, row)) {
    await markSerpFailed(deps.db, row.id, LIVE_REVOKED_BEFORE_FETCH)
    return 'failed'
  }
  let fetched: FetchedTask
  try {
    fetched = await deps.serp.providerFor(row.mode).fetchTask({
      taskId: row.taskId ?? '',
      keyword: row.keyword,
      abortSignal: AbortSignal.timeout(timeoutMs),
      fakeHints: {
        brand: { name: brand.name, domain: brand.domain },
        competitors: brand.competitors.map((c) => ({ name: c.name, domain: c.domain })),
      },
    })
  } catch (error) {
    // タスク自体のエラーは取り直しても同じなので、失敗として記録する
    if (error instanceof SerpApiError && error.scope === 'task') {
      await markSerpFailed(deps.db, row.id, `検索の結果を取得できませんでした：${error.message}`)
      return 'failed'
    }
    // 障害（HTTP のエラー・応答の形の違い・通信のエラーなど）は、最後のエラーを残して次の回に取り直す
    await recordFetchError(deps.db, row.id, errorMessage(error))
    return 'stillPending'
  }
  if (fetched.status === 'pending') {
    // 普通に応答が返ってきた（まだ結果が出ていないだけ）ので、前の障害のエラーは消す
    await recordFetchError(deps.db, row.id, null)
    return 'stillPending'
  }

  const extraction = await extractAiOverview(
    deps.extractorFor(row.organizationId),
    fetched.serp,
    brand,
    AbortSignal.timeout(timeoutMs),
  )
  await saveSerpSuccess(deps.db, {
    serpResultId: row.id,
    serp: fetched.serp,
    raw: fetched.raw,
    brand,
    extraction,
  })
  return 'succeeded'
}

async function competitorsOf(db: Db, brandIds: string[]) {
  const grouped = new Map<string, SerpBrand['competitors']>()
  if (brandIds.length === 0) return grouped
  const rows = await db
    .select({
      id: competitorTable.id,
      brandId: competitorTable.brandId,
      name: competitorTable.name,
      aliases: competitorTable.aliases,
      domain: competitorTable.domain,
    })
    .from(competitorTable)
    .where(inArray(competitorTable.brandId, brandIds))
    .orderBy(asc(competitorTable.createdAt))
  for (const { brandId, ...c } of rows) grouped.set(brandId, [...(grouped.get(brandId) ?? []), c])
  return grouped
}

/**
 * 回収するまでの時間の初期値（行を作ってから）。毎朝のジョブは、頼む・待つ（5 分 × 12 回）・取りに行くで
 * 1 時間ほどかかり、Inngest のリトライが入ると延びる。それより十分長くして、動いているジョブの行を終わらせない
 */
export const DEFAULT_SERP_STALE_AFTER_MINUTES = 180

/**
 * pending の行を終わらせるときの理由。頼んだか（障害で取れていないか・まだ出ていないか）・
 * 頼めたか確かめられないか・頼む前か、で分ける
 */
const giveUpReason = sql`case
  when ${serpResult.taskId} is not null and ${serpResult.lastFetchError} is not null
    then left('検索の結果を取得できませんでした（最後のエラー：' || ${serpResult.lastFetchError} || '）', ${MAX_ERROR_LENGTH})
  when ${serpResult.taskId} is not null then '時間内に検索の結果が出ませんでした'
  when ${serpResult.postAttemptedAt} is not null then '検索を頼めたか確かめられませんでした（二重に費用がかからないよう、頼み直していません）'
  else '検索を頼む前に、ジョブが終わりました' end`

/**
 * pending の行を、理由を付けて failed にする。終わった行には触らない。
 * failed にした行は二度と頼まない（頼み始めた印があって task ID のない行も、頼み直さない）
 */
async function failPendingSerp(db: Db, where: SQL): Promise<number> {
  const rows = await db
    .update(serpResult)
    .set({ status: 'failed', error: giveUpReason })
    .where(and(eq(serpResult.status, 'pending'), where))
    .returning({ id: serpResult.id })
  return rows.length
}

/**
 * その日のまだ pending の行を、すべて failed にして終わらせる（待つのをやめるとき・ジョブが落ちたとき）。
 * 終わらせた行の数を返す
 */
export async function giveUpSerpTasks(db: Db, date: string): Promise<number> {
  return failPendingSerp(db, eq(serpResult.searchedOn, date))
}

/**
 * 期限を過ぎた pending の行を回収する（recover-stale-runs と同じ考え方）。
 * ジョブが取り消された・onFailure が失敗したなどで、give-up まで届かずに残った行を終わらせる。
 * 判定と更新を 1 つの UPDATE で行う。回収した行の数を返す
 */
export async function recoverStaleSerpResults(
  db: Db,
  options: { staleAfterMinutes?: number; now?: Date } = {},
): Promise<number> {
  const minutes = options.staleAfterMinutes ?? DEFAULT_SERP_STALE_AFTER_MINUTES
  const cutoff = new Date((options.now ?? new Date()).getTime() - minutes * 60_000)
  return failPendingSerp(db, lt(serpResult.createdAt, cutoff))
}

/**
 * その行を、行のモードのまま扱ってよいか。live の行は、その組織が今も本物を使ってよいときだけ。
 * fake の行は費用がかからないので、いつでもフェイクで扱う（あとから許可が付いても本物には切り替えない）
 */
function isModeAllowed(deps: SerpDeps, row: { mode: SerpMode; organizationId: string }): boolean {
  return row.mode === 'fake' || deps.serp.modeFor(row.organizationId) === 'live'
}

/** 結果の取得の最後のエラーを残す（null なら消す）。pending の行だけ */
async function recordFetchError(db: Db, id: string, message: string | null) {
  await db
    .update(serpResult)
    .set({
      lastFetchError: message === null ? null : message.slice(0, MAX_ERROR_LENGTH),
      lastFetchErrorAt: message === null ? null : sql`now()`,
    })
    .where(and(eq(serpResult.id, id), eq(serpResult.status, 'pending')))
}

async function markSerpFailed(db: Db, id: string, message: string) {
  await db
    .update(serpResult)
    .set({ status: 'failed', error: message.slice(0, MAX_ERROR_LENGTH) })
    .where(and(eq(serpResult.id, id), eq(serpResult.status, 'pending')))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
