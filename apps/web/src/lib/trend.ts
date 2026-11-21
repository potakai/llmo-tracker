import type { TrendRow } from '@/components/trend-chart'
import type { BrandMetrics } from '@/server/queries/metrics'

const toPct = (v: number | null) => (v === null ? null : v * 100)

/** 集計結果をグラフ用の行にする（割合は 0〜100 に） */
export function toTrendRows(metrics: Pick<BrandMetrics, 'trend'>): TrendRow[] {
  return metrics.trend.all.map((point, i) => ({
    date: point.date,
    all: toPct(point.rate),
    band: point.low === null || point.high === null ? null : [point.low * 100, point.high * 100],
    openai: toPct(metrics.trend.openai[i]?.rate ?? null),
    gemini: toPct(metrics.trend.gemini[i]?.rate ?? null),
    n: point.n,
  }))
}

/**
 * 値のある日が 1 日しかなければ、その行と位置を返す（線にならず点が 1 つだけになる）。
 * 2 日以上あれば null
 */
export function findLonePoint(rows: TrendRow[]): { index: number; row: TrendRow } | null {
  const withValue = rows.flatMap((row, index) => (row.all === null ? [] : [{ index, row }]))
  return withValue.length === 1 ? (withValue[0] ?? null) : null
}
