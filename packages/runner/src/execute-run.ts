import {
  citation,
  type Db,
  type Provider,
  prompt as promptTable,
  response,
  run as runTable,
} from '@llmo/db'
import {
  type AskResult,
  type Extractor,
  estimateCostUsd,
  type ProviderId,
  type Providers,
} from '@llmo/llm'
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm'
import { analyzeRun } from './analyze'
import { runUntilDeadline } from './deadline'

// DB の provider enum と LLM 側の ProviderId がずれたらここで型エラーになる
const _providerIdsMatch: [Provider] extends [ProviderId]
  ? [ProviderId] extends [Provider]
    ? true
    : never
  : never = true
void _providerIdsMatch

/** run の処理に使う AI：回答をもらうプロバイダーと、回答から言及を取り出す抽出器 */
export type RunLlm = {
  providers: Providers
  /** 回答から言及を取り出す（LLM またはルールベース） */
  extractor: Extractor
}

export type ExecuteRunDeps = {
  db: Db
  /** 同時に投げる質問の数（API のレート制限に合わせて調整） */
  concurrency?: number
  /** 1 回の質問のタイムアウト */
  timeoutMs?: number
} & (
  | RunLlm
  /** 組織ごとに AI を選ぶ（本物の AI を使ってよい組織だけ live にする）。run のブランドの組織 ID が渡される */
  | { llmFor: (organizationId: string) => RunLlm }
)

export type RunSummary = {
  runId: string
  status: 'succeeded' | 'partial' | 'failed'
  total: number
  succeeded: number
  failed: number
  totalCostUsd: number
}

type Task = {
  promptId: string
  promptText: string
  provider: ProviderId
  sampleIndex: number
}

const FINISHED = new Set(['succeeded', 'partial', 'failed'])

/** run がない（ブランドごと消された など）。ジョブはリトライしても意味がないので、すぐ諦める */
export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`run ${runId} が見つかりません`)
  }
}

export type RunSliceOptions = {
  /**
   * この時間（ミリ秒）を使い切ったら、新しい質問・抽出を始めない。投げ途中のものは待つので、
   * 1 回の呼び出しは最長で budgetMs + timeoutMs くらいかかる。
   */
  budgetMs: number
  /** この時刻より前に失敗した回答だけを聞き直す。省略すると、失敗した回答は聞き直さない */
  retryFailedBefore?: Date
}

export type RunSliceResult = { done: false } | { done: true; summary: RunSummary }

/**
 * 実行バッチを1つ処理する：質問 × AI × サンプル数 の分だけ AI に聞いて、回答を保存する。
 * 中身は executeRunSlice を終わるまで呼ぶだけ。呼び出しの最初の時刻より前に失敗していた回答は聞き直す。
 *
 * 何度呼んでも安全（冪等）に作ってある：
 * - すでに成功している回答は聞き直さない（途中で落ちても、続きから再開できる）
 * - 失敗している回答だけを聞き直して上書きする
 * - 終わっている run を渡されたら、何もせず集計だけ返す
 */
export async function executeRun(deps: ExecuteRunDeps, runId: string): Promise<RunSummary> {
  const retryFailedBefore = await dbNow(deps.db)
  // 区切る必要がない（時間の上限がない）ので予算は無制限。1 回の slice で最後まで進む
  const options = { budgetMs: Number.POSITIVE_INFINITY, retryFailedBefore }
  for (;;) {
    const result = await executeRunSlice(deps, runId, options)
    if (result.done) return result.summary
  }
}

/**
 * run を時間で区切って少しずつ処理する。1 回の呼び出しを、サーバーレス関数の実行時間の上限内に収めるため。
 *
 * - まだ回答がない（または retryFailedBefore より前に失敗した）分を聞く。予算を使い切ったら新しく投げず、
 *   投げ途中のものを待って { done: false } を返す
 * - 回答が揃っていたら言及を抽出する。抽出も予算で区切る
 * - 抽出まで終わったら run を終わらせて { done: true, summary } を返す。終わっている run なら何もしない
 *
 * 毎回 DB から残りを数え直すので、どこで区切られても（落ちても）続きから再開できる。
 */
export async function executeRunSlice(
  deps: ExecuteRunDeps,
  runId: string,
  options: RunSliceOptions,
): Promise<RunSliceResult> {
  const deadline = Date.now() + options.budgetMs
  const { db } = deps

  const target = await db.query.run.findFirst({
    where: eq(runTable.id, runId),
    with: {
      brand: {
        with: {
          competitors: true,
          prompts: { where: isNull(promptTable.archivedAt) },
        },
      },
    },
  })
  if (!target) throw new RunNotFoundError(runId)
  if (FINISHED.has(target.status)) return { done: true, summary: await summarize(db, runId) }
  const { providers, extractor } =
    'llmFor' in deps ? deps.llmFor(target.brand.organizationId) : deps

  await db
    .update(runTable)
    .set({ status: 'running', startedAt: sql`coalesce(${runTable.startedAt}, now())` })
    .where(eq(runTable.id, runId))

  const brand = target.brand
  const tasks = await pendingTasks(db, runId, brand, options.retryFailedBefore)
  const hints = { names: [brand.name, ...brand.competitors.map((c) => c.name)] }
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const askedAll = await runUntilDeadline(tasks, { concurrency, deadline }, async (task) => {
    try {
      const result = await providers[task.provider].ask({
        prompt: task.promptText,
        abortSignal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        fakeHints: hints,
      })
      await saveSuccess(db, runId, task, result, brand.domain)
    } catch (error) {
      await saveFailure(db, runId, task, providers[task.provider].model, error)
    }
  })
  if (!askedAll) return { done: false }

  // 回答がそろってから、まとめて分析する（分析だけ失敗しても回答は残る。あとから再分析できる）
  const { remaining } = await analyzeRun({ db, extractor, concurrency }, runId, { deadline })
  if (remaining > 0) return { done: false }

  const summary = await summarize(db, runId)
  await db
    .update(runTable)
    .set({ status: summary.status, finishedAt: new Date(), totalCostUsd: summary.totalCostUsd })
    .where(eq(runTable.id, runId))
  return { done: true, summary }
}

// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 120_000

type BrandForTasks = {
  prompts: { id: string; text: string }[]
  providers: ProviderId[]
  samplesPerPrompt: number
}

/**
 * まだ聞く必要がある回答の一覧。成功済みは除く。失敗済みは、retryFailedBefore より前に失敗したものだけ残す
 * （同じ通しの中で失敗したものを聞き直し続けると、失敗し続ける AI があったときに終わらないため）。
 */
async function pendingTasks(
  db: Db,
  runId: string,
  brand: BrandForTasks,
  retryFailedBefore: Date | undefined,
): Promise<Task[]> {
  // 聞き終わった行：成功したもの、または retryFailedBefore 以降に失敗したもの（省略時は失敗もすべて）
  const isSettled =
    retryFailedBefore === undefined
      ? undefined
      : or(eq(response.status, 'succeeded'), gte(response.createdAt, retryFailedBefore))
  const settled = await db
    .select({
      promptId: response.promptId,
      provider: response.provider,
      sampleIndex: response.sampleIndex,
    })
    .from(response)
    .where(and(eq(response.runId, runId), isSettled))
  const settledKeys = new Set(settled.map((r) => key(r.promptId, r.provider, r.sampleIndex)))

  return brand.prompts.flatMap((p) =>
    brand.providers.flatMap((provider) =>
      Array.from({ length: brand.samplesPerPrompt }, (_, sampleIndex) => ({
        promptId: p.id,
        promptText: p.text,
        provider,
        sampleIndex,
      })).filter((t) => !settledKeys.has(key(t.promptId, t.provider, t.sampleIndex))),
    ),
  )
}

/** DB の時計での現在時刻（response.created_at と比べるため、アプリの時計は使わない） */
async function dbNow(db: Db): Promise<Date> {
  // ミリ秒に切り捨てるので、この時刻以降に保存された行は必ず「以降」と判定される
  const [row] = await db.execute<{ ms: string }>(
    sql`select floor(extract(epoch from now()) * 1000)::bigint::text as ms`,
  )
  if (!row) throw new Error('DB の現在時刻を取得できませんでした')
  return new Date(Number(row.ms))
}

function key(promptId: string, provider: string, sampleIndex: number) {
  return `${promptId}:${provider}:${sampleIndex}`
}

const conflictTarget = [response.runId, response.promptId, response.provider, response.sampleIndex]

async function saveSuccess(
  db: Db,
  runId: string,
  task: Task,
  result: AskResult,
  brandDomain: string | null,
) {
  const values = {
    runId,
    promptId: task.promptId,
    provider: task.provider,
    sampleIndex: task.sampleIndex,
    model: result.model,
    status: 'succeeded' as const,
    answerText: result.text,
    error: null,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: estimateCostUsd(result),
  }

  await db.transaction(async (tx) => {
    // 前回失敗していた行だけは上書きする。成功済みの行はそのまま（返り値が空になる）
    const [saved] = await tx
      .insert(response)
      .values(values)
      .onConflictDoUpdate({
        target: conflictTarget,
        set: { ...values, createdAt: new Date() },
        setWhere: eq(response.status, 'failed'),
      })
      .returning({ id: response.id })
    if (!saved) return

    await tx.delete(citation).where(eq(citation.responseId, saved.id))
    const citations = toCitations(result.sources, brandDomain)
    if (citations.length > 0) {
      await tx.insert(citation).values(citations.map((c) => ({ ...c, responseId: saved.id })))
    }
  })
}

async function saveFailure(db: Db, runId: string, task: Task, model: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const values = {
    runId,
    promptId: task.promptId,
    provider: task.provider,
    sampleIndex: task.sampleIndex,
    model,
    status: 'failed' as const,
    answerText: null,
    error: message.slice(0, 1000),
  }
  await db
    .insert(response)
    .values(values)
    .onConflictDoUpdate({
      target: conflictTarget,
      set: { ...values, createdAt: sql`now()` },
      setWhere: eq(response.status, 'failed'),
    })
}

/** 引用元を DB の形にする。同じ URL は最初の1つだけ残す */
export function toCitations(sources: AskResult['sources'], brandDomain: string | null) {
  const seen = new Set<string>()
  const rows: {
    url: string
    domain: string
    title: string | null
    position: number
    isOwnDomain: boolean
  }[] = []
  for (const source of sources) {
    if (seen.has(source.url)) continue
    let domain: string
    try {
      domain = new URL(source.url).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      continue
    }
    seen.add(source.url)
    rows.push({
      url: source.url,
      domain,
      title: source.title ?? null,
      position: rows.length,
      isOwnDomain:
        brandDomain !== null && (domain === brandDomain || domain.endsWith(`.${brandDomain}`)),
    })
  }
  return rows
}

async function summarize(db: Db, runId: string): Promise<RunSummary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${response.status} = 'succeeded')::int`,
      cost: sql<string>`coalesce(sum(${response.costUsd}), 0)`,
    })
    .from(response)
    .where(eq(response.runId, runId))
  const total = row?.total ?? 0
  const succeeded = row?.succeeded ?? 0
  const failed = total - succeeded
  return {
    runId,
    status: succeeded === 0 ? 'failed' : failed > 0 ? 'partial' : 'succeeded',
    total,
    succeeded,
    failed,
    totalCostUsd: Math.round(Number(row?.cost ?? 0) * 10_000) / 10_000,
  }
}
