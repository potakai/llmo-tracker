'use client'

import { useRouter } from 'next/navigation'

/** 質問で絞り込むセレクト。選んだら URL を変える（行き先はサーバー側で作って渡してもらう） */
export function PromptSelect(props: {
  prompts: { id: string; text: string }[]
  value: string
  hrefs: Record<string, string>
}) {
  const router = useRouter()
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-sm text-ink-soft">質問</span>
      <select
        className="field max-w-xs py-1 text-sm"
        value={props.value}
        onChange={(event) => {
          const href = props.hrefs[event.target.value]
          if (href) router.push(href, { scroll: false })
        }}
      >
        <option value="">すべての質問</option>
        {props.prompts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.text}
          </option>
        ))}
      </select>
    </label>
  )
}
