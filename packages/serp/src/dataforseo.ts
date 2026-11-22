import { z } from 'zod'
import {
  DATAFORSEO_BASE_URL,
  JAPAN_LOCATION_CODE,
  JAPANESE_LANGUAGE_CODE,
  PENDING_STATUS_CODES,
  SERP_DEPTH,
  STATUS,
  TASK_GET_ADVANCED_PATH,
  TASK_POST_PATH,
} from './dataforseo-constants'
import { parseSerpResult } from './parse'
import { type FetchedTask, type PostedTask, SerpApiError, type SerpProvider } from './types'

/**
 * 本物の DataForSEO（Google Organic SERP API の Standard queue）。
 * 認証は Basic（API のログインとパスワード。ダッシュボードの API Access にあるもの）。
 * https://docs.dataforseo.com/v3/auth/
 */
export type DataForSeoOptions = {
  login: string
  password: string
  /** テストで差し替える */
  fetch?: typeof globalThis.fetch
  baseUrl?: string
}

/** task_post に送るタスク 1 件。日本の Google（デスクトップ）の上位 10 件と、AI による概要を取る */
export function buildTaskPostBody(keyword: string, tag?: string) {
  return {
    keyword,
    location_code: JAPAN_LOCATION_CODE,
    language_code: JAPANESE_LANGUAGE_CODE,
    device: 'desktop',
    depth: SERP_DEPTH,
    // あとから読み込まれる AI による概要も取る（取らないと、出ているのに「出ていない」と記録してしまう）。
    // 1 件 $0.0006 の追加。AI による概要が出なかったときなどは返金される
    load_async_ai_overview: true,
    ...(tag ? { tag } : {}),
  }
}

const taskSchema = z.object({
  id: z.string().min(1),
  status_code: z.number(),
  status_message: z.string(),
  cost: z.number().nullish(),
  result: z.array(z.unknown()).nullish(),
})

const envelopeSchema = z.object({
  status_code: z.number(),
  status_message: z.string(),
  tasks: z.array(taskSchema).nullish(),
})

type DataForSeoTask = z.infer<typeof taskSchema>

export function createDataForSeoProvider(options: DataForSeoOptions): SerpProvider {
  const doFetch = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? DATAFORSEO_BASE_URL
  const authorization = `Basic ${Buffer.from(`${options.login}:${options.password}`).toString('base64')}`

  /** 呼び出して、最初のタスクを返す。全体がエラーなら例外 */
  async function call(path: string, init: RequestInit): Promise<DataForSeoTask> {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization, 'content-type': 'application/json' },
    })
    if (!res.ok) {
      throw new SerpApiError(`DataForSEO が HTTP ${res.status} を返しました`, null, 'request')
    }
    const parsed = envelopeSchema.safeParse(await readJson(res))
    if (!parsed.success) {
      throw new SerpApiError(
        `DataForSEO の応答の形が想定と違います（${describeIssue(parsed.error)}）`,
        null,
        'request',
      )
    }
    const body = parsed.data
    if (body.status_code !== STATUS.OK) {
      throw new SerpApiError(`DataForSEO: ${body.status_message}`, body.status_code, 'request')
    }
    const task = body.tasks?.[0]
    if (!task) throw new SerpApiError('DataForSEO の応答にタスクがありません', null, 'request')
    return task
  }

  return {
    mode: 'live',

    async postTask({ keyword, tag, abortSignal }): Promise<PostedTask> {
      const task = await call(TASK_POST_PATH, {
        method: 'POST',
        body: JSON.stringify([buildTaskPostBody(keyword, tag)]),
        signal: abortSignal,
      })
      if (task.status_code !== STATUS.TASK_CREATED) {
        throw new SerpApiError(`DataForSEO: ${task.status_message}`, task.status_code, 'task')
      }
      return { taskId: task.id, costUsd: task.cost ?? null }
    },

    async fetchTask({ taskId, abortSignal }): Promise<FetchedTask> {
      const task = await call(`${TASK_GET_ADVANCED_PATH}/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        signal: abortSignal,
      })
      return toFetchedTask(task)
    },
  }
}

/** task_get のタスクを、待つ・結果あり・エラー に振り分ける */
export function toFetchedTask(task: DataForSeoTask): FetchedTask {
  if (PENDING_STATUS_CODES.has(task.status_code)) return { status: 'pending' }
  if (task.status_code === STATUS.NO_SEARCH_RESULTS) {
    return { status: 'ready', serp: { organic: [], aiOverview: null }, raw: task }
  }
  if (task.status_code !== STATUS.OK) {
    throw new SerpApiError(`DataForSEO: ${task.status_message}`, task.status_code, 'task')
  }
  const result = task.result?.[0]
  return { status: 'ready', serp: parseSerpResult(result), raw: result ?? null }
}

/** 本文を JSON として読む。JSON でなければ、応答の形の違いとして扱う */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw new SerpApiError('DataForSEO の応答が JSON ではありません', null, 'request')
  }
}

/** 形の違いの最初の 1 件（どの項目が違うか） */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return '不明'
  const path = issue.path.length > 0 ? issue.path.join('.') : '（全体）'
  return `${path}: ${issue.message}`
}
