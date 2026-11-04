import Link from 'next/link'
import { filterHref } from '@/lib/filters'
import type { MetricsQuery } from '@/server/schemas/brand'
import { PromptSelect } from './prompt-select'

const DAYS = [7, 30, 90] as const
const AIS = [
  { value: undefined, label: 'すべての AI' },
  { value: 'openai', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
] as const

/**
 * 期間・AI・質問の絞り込み。状態はすべて URL に持つので、リンクを共有しても同じ画面になる。
 * 期間と AI はただのリンク（JavaScript なしでも動き、キーボードでたどれる）。
 */
export function FilterBar(props: {
  path: string
  current: MetricsQuery
  prompts?: { id: string; text: string }[]
}) {
  const { path, current } = props
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Segmented label="グラフの期間">
        {DAYS.map((days) => (
          <Segment
            key={days}
            href={filterHref(path, current, { days })}
            active={current.days === days}
          >
            {days}日
          </Segment>
        ))}
      </Segmented>
      <Segmented label="AI">
        {AIS.map((ai) => (
          <Segment
            key={ai.label}
            href={filterHref(path, current, { ai: ai.value })}
            active={current.ai === ai.value}
          >
            {ai.label}
          </Segment>
        ))}
      </Segmented>
      {props.prompts && (
        <PromptSelect
          prompts={props.prompts}
          value={current.q ?? ''}
          hrefs={Object.fromEntries([
            ['', filterHref(path, current, { q: undefined })],
            ...props.prompts.map((p) => [p.id, filterHref(path, current, { q: p.id })]),
          ])}
        />
      )}
    </div>
  )
}

function Segmented({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-ink-soft">{label}</span>
      <ul className="flex rounded-[var(--radius-box)] border border-rule bg-surface p-0.5">
        {children}
      </ul>
    </div>
  )
}

function Segment(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={props.href}
        scroll={false}
        aria-current={props.active ? 'true' : undefined}
        className={`block rounded-[4px] px-3 py-1 text-sm ${
          props.active ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
        }`}
      >
        {props.children}
      </Link>
    </li>
  )
}
