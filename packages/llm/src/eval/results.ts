import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExtractionResult } from '../extract/types'
import type { ReportCase, ReportUsage } from './report'
import type { EvalMetrics } from './score'

/** packages/llm/eval/results（git には入れない） */
export const RESULTS_DIR = join(import.meta.dirname, '../../eval/results')

const pad = (n: number): string => String(n).padStart(2, '0')

/** <YYYYMMDD-HHmm>-<extractor>.json（手元の時刻） */
export function resultFileName(date: Date, extractor: string): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}-${extractor}.json`
}

export type ResultFile = {
  extractor: string
  modelId: string
  startedAt: string
  only: string | null
  metrics: EvalMetrics
  usage: ReportUsage | null
  /** 抽出器が返したもの（LLM の生の出力やフォールバックの理由を含む）をそのまま残す */
  cases: (Omit<ReportCase, 'actual'> & { result: ExtractionResult | null; durationMs: number })[]
}

/** 全ケースの詳細を JSON で保存し、保存先のパスを返す */
export async function saveResult(file: ResultFile, date: Date): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true })
  const path = join(RESULTS_DIR, resultFileName(date, file.extractor))
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  return path
}
