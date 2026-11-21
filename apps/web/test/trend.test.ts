import { describe, expect, it } from 'vitest'
import type { TrendRow } from '@/components/trend-chart'
import { findLonePoint } from '@/lib/trend'

const row = (date: string, all: number | null): TrendRow => ({
  date,
  all,
  band: null,
  openai: null,
  gemini: null,
  n: all === null ? 0 : 10,
})

describe('findLonePoint', () => {
  it('値のある日が 1 日だけなら、その日を返す', () => {
    const rows = [row('2026-11-19', null), row('2026-11-20', null), row('2026-11-21', 40)]
    expect(findLonePoint(rows)).toEqual({ index: 2, row: rows[2] })
  })

  it('値のある日が 2 日以上なら、線になるので null', () => {
    const rows = [row('2026-11-19', null), row('2026-11-20', 30), row('2026-11-21', 40)]
    expect(findLonePoint(rows)).toBeNull()
  })

  it('値のある日がなければ null', () => {
    expect(findLonePoint([row('2026-11-21', null)])).toBeNull()
  })
})
