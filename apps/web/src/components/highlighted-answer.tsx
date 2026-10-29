import type { ReactNode } from 'react'

type Mark = { name: string; entityType: 'brand' | 'competitor' | 'unknown' }

const STYLE: Record<Mark['entityType'], string> = {
  brand: 'bg-own-soft shadow-[inset_0_-0.45em_0_var(--color-own)] font-bold',
  competitor: 'bg-rival-soft',
  unknown: 'bg-transparent underline decoration-dotted decoration-ink-soft underline-offset-4',
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 回答の中の名前に色を付ける。自社はマーカー、競合は薄い青、未登録の会社は点線。
 * 抽出結果の表記（回答中の表記そのまま）で探すので、どこが拾われたかが目で確かめられる。
 */
export function HighlightedAnswer({ text, marks }: { text: string; marks: Mark[] }) {
  const usable = marks.filter((m) => m.name.trim().length > 0)
  if (usable.length === 0) return <p className="whitespace-pre-wrap">{text}</p>

  // 長い名前を先に当てる（「◯◯会計」と「◯◯」が両方あるときに長い方を優先）
  const sorted = [...usable].sort((a, b) => b.name.length - a.name.length)
  const pattern = new RegExp(`(${sorted.map((m) => escapeRegExp(m.name)).join('|')})`, 'gi')
  const typeOf = (part: string) =>
    sorted.find((m) => m.name.toLowerCase() === part.toLowerCase())?.entityType

  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    const type = typeOf(match[0])
    nodes.push(
      <mark
        key={index}
        className={`rounded-[2px] px-0.5 text-ink ${type ? STYLE[type] : 'bg-transparent'}`}
      >
        {match[0]}
      </mark>,
    )
    cursor = index + match[0].length
  }
  nodes.push(text.slice(cursor))
  return <p className="whitespace-pre-wrap">{nodes}</p>
}
