/**
 * 保存済みの評価結果（eval/results/*.json）に残した LLM の生の出力（raw）に、
 * 現在の突き合わせと感情の変換をかけ直す。API は呼ばないので費用はかからない。
 */
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { buildLlmExtractionResult, llmExtractionSchema } from '../extract/llm'
import type { GoldenCase } from './golden'
import type { CaseOutcome } from './run'

/** replay の結果ファイルも、もう一度 replay できるようにする */
const REPLAYABLE_EXTRACTORS = ['llm', 'llm-replay']

/** ResultFile のうち、replay に使うところだけ */
const replayFileSchema = z.object({
  extractor: z.string(),
  modelId: z.string().min(1),
  cases: z.array(
    z.object({
      id: z.string(),
      result: z.object({ raw: z.unknown() }).nullable(),
    }),
  ),
})

export type ReplaySource = {
  modelId: string
  /** ケースの id → 保存した raw（抽出に失敗したケースは null） */
  rawById: ReadonlyMap<string, { raw: unknown } | null>
}

export function parseReplaySource(json: unknown, path: string): ReplaySource {
  const parsed = replayFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `replay する結果ファイル（${path}）が正しくありません:\n${z.prettifyError(parsed.error)}`,
    )
  }
  const { extractor, modelId, cases } = parsed.data
  if (!REPLAYABLE_EXTRACTORS.includes(extractor)) {
    throw new Error(
      `replay できるのは LLM の抽出器の結果ファイルだけです（${path} は ${extractor} の結果）`,
    )
  }
  return { modelId, rawById: new Map(cases.map((c) => [c.id, c.result])) }
}

export async function loadReplaySource(path: string): Promise<ReplaySource> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`replay する結果ファイル（${path}）を読めません: ${String(error)}`)
  }
  return parseReplaySource(JSON.parse(text), path)
}

const failed = (id: string, error: string): CaseOutcome => ({
  id,
  result: null,
  error,
  durationMs: 0,
})

/** 本番の LLM 抽出器がフォールバックしたときに残す形（{ fallbackFrom, error }） */
function fallbackError(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || !('fallbackFrom' in raw)) return null
  const detail = 'error' in raw ? String(raw.error) : '理由は不明'
  return `保存した結果では、ルールベースにフォールバックしています（${detail}）`
}

function replayOne(c: GoldenCase, source: ReplaySource): CaseOutcome {
  if (!source.rawById.has(c.id)) return failed(c.id, '保存した結果に、このケースがありません')
  const saved = source.rawById.get(c.id)
  if (!saved) return failed(c.id, '保存した結果では、抽出に失敗しています')
  const fallback = fallbackError(saved.raw)
  if (fallback) return failed(c.id, fallback)
  const llm = llmExtractionSchema.safeParse(saved.raw)
  if (!llm.success) return failed(c.id, `保存した LLM の出力が読めません: ${llm.error.message}`)
  return {
    id: c.id,
    result: buildLlmExtractionResult(c.input, llm.data, source.modelId),
    error: null,
    durationMs: 0,
  }
}

/** ゴールデンセットの入力と保存した raw から、ケースごとの結果を作り直す（順番はケースのまま） */
export function replayOutcomes(cases: readonly GoldenCase[], source: ReplaySource): CaseOutcome[] {
  return cases.map((c) => replayOne(c, source))
}
