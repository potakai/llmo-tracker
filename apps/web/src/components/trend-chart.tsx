'use client'

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type TrendRow = {
  date: string
  all: number | null
  band: [number, number] | null
  openai: number | null
  gemini: number | null
  n: number
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Math.round(v)}%`
const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

/**
 * 言及率の推移。太線が全体（AI 2つの合計）、帯がその 95% 信頼区間、細線が AI ごと。
 * 帯が広い日は「まだ数字がぶれやすい」と読める。
 */
export function TrendChart({ rows }: { rows: TrendRow[] }) {
  // 計測した日が少ないうちは線にならないので、点も描く
  const sparse = rows.filter((r) => r.all !== null).length < 3
  const dot = (color: string, r = 3) => (sparse ? { r, fill: color, stroke: color } : false)
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--color-rule)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: 'var(--color-ink-soft)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-rule)' }}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: 'var(--color-ink-soft)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as TrendRow | undefined
              if (!active || !row) return null
              return (
                <div className="panel px-3 py-2 text-sm shadow-sm">
                  <p className="font-bold">{shortDate(row.date)} までの7日間</p>
                  <p className="num">
                    全体 {pct(row.all)}（
                    {row.band ? `${pct(row.band[0])}〜${pct(row.band[1])}` : '—'}）
                  </p>
                  <p className="num text-openai">ChatGPT {pct(row.openai)}</p>
                  <p className="num text-gemini">Gemini {pct(row.gemini)}</p>
                  <p className="num text-ink-soft">回答 {row.n} 件</p>
                </div>
              )
            }}
          />
          <Area
            dataKey="band"
            stroke="none"
            fill="var(--color-ink)"
            fillOpacity={0.08}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="openai"
            stroke="var(--color-openai)"
            strokeWidth={1.5}
            dot={dot('var(--color-openai)')}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="gemini"
            stroke="var(--color-gemini)"
            strokeWidth={1.5}
            dot={dot('var(--color-gemini)')}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="all"
            stroke="var(--color-ink)"
            strokeWidth={2.5}
            dot={dot('var(--color-ink)', 4)}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
