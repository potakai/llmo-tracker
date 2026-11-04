import { type MetricsQuery, metricsQuery } from '@/server/schemas/brand'

/** 絞り込みの状態を URL のクエリにする（初期値は書かない＝URL を短く保つ） */
export function filterHref(path: string, current: MetricsQuery, changes: Partial<MetricsQuery>) {
  const next = { ...current, ...changes }
  const params = new URLSearchParams()
  if (next.days !== 30) params.set('days', String(next.days))
  if (next.ai) params.set('ai', next.ai)
  if (next.q) params.set('q', next.q)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** URL の絞り込みを読む。おかしな値なら初期値に戻す */
export function parseFilter(raw: Record<string, string | string[] | undefined>): MetricsQuery {
  const parsed = metricsQuery.safeParse(raw)
  return parsed.success ? parsed.data : { days: 30 }
}
