import type { ExtractionResult, Extractor } from '../extract/types'
import type { GoldenCase } from './golden'

export type CaseOutcome = {
  id: string
  /** 抽出器が返した結果。例外で止まったときは null */
  result: ExtractionResult | null
  /** 失敗の理由。null でなければ、このケースは不正解として数える */
  error: string | null
  durationMs: number
}

export type RunOptions = {
  /** 同時に動かす抽出の数 */
  concurrency: number
  /** 1件あたりの時間の上限 */
  timeoutMs: number
}

const MAX_ERROR_LENGTH = 500

/**
 * LLM の抽出器は失敗するとルールベースの結果を返す（raw.fallbackFrom が付く）。
 * 評価ではそれを LLM の正解として数えないよう、失敗の理由を取り出す。
 */
function fallbackReason(result: ExtractionResult): string | null {
  const raw = result.raw
  if (typeof raw !== 'object' || raw === null || !('fallbackFrom' in raw)) return null
  const detail = 'error' in raw ? String(raw.error) : '理由は不明'
  return `ルールベースにフォールバックしました（${detail}）`
}

async function runOne(
  c: GoldenCase,
  extractor: Extractor,
  timeoutMs: number,
): Promise<CaseOutcome> {
  const startedAt = Date.now()
  try {
    const result = await extractor.extract({
      ...c.input,
      abortSignal: AbortSignal.timeout(timeoutMs),
    })
    return { id: c.id, result, error: fallbackReason(result), durationMs: Date.now() - startedAt }
  } catch (error) {
    // 1件の失敗で全体を止めない。理由を残して不正解として数える
    return {
      id: c.id,
      result: null,
      error: String(error).slice(0, MAX_ERROR_LENGTH),
      durationMs: Date.now() - startedAt,
    }
  }
}

/** ケースを concurrency 件ずつ並行して抽出する。結果はケースの順番どおりに並ぶ */
export async function runExtraction(
  cases: readonly GoldenCase[],
  extractor: Extractor,
  options: RunOptions,
): Promise<CaseOutcome[]> {
  const outcomes = new Map<number, CaseOutcome>()
  const queue = cases.map((c, index) => ({ c, index }))
  let next = 0
  const worker = async (): Promise<void> => {
    for (let item = queue[next++]; item !== undefined; item = queue[next++]) {
      outcomes.set(item.index, await runOne(item.c, extractor, options.timeoutMs))
    }
  }
  const workerCount = Math.max(1, Math.min(options.concurrency, cases.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
  return cases.map(
    (c, i) =>
      outcomes.get(i) ?? { id: c.id, result: null, error: '実行されませんでした', durationMs: 0 },
  )
}
