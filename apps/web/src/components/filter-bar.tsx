import Link from 'next/link'
import { filterHref } from '@/lib/filters'
import type { MetricsQuery } from '@/server/schemas/brand'
import { PROMPT_KIND_LABEL } from './labels'
import { PromptSelect } from './prompt-select'

const DAYS = [7, 30, 90] as const
const AIS = [
  { value: undefined, label: 'すべての AI' },
  { value: 'openai', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
] as const
const KINDS = [
  { value: undefined, label: 'すべて' },
  { value: 'question', label: PROMPT_KIND_LABEL.question },
  { value: 'keyword', label: PROMPT_KIND_LABEL.keyword },
] as const

/**
 * 期間・AI・種類・質問の絞り込み。状態はすべて URL に持つので、リンクを共有しても同じ画面になる。
 * 期間と AI はただのリンク（JavaScript なしでも動き、キーボードでたどれる）。
 */
export function FilterBar(props: {
  path: string
  current: MetricsQuery
  /** 渡すと、種類と質問の絞り込みを出す */
  prompts?: { id: string; text: string; kind: keyof typeof PROMPT_KIND_LABEL }[]
}) {
  const { path, current } = props
  // 種類で絞り込んでいるときは、質問の選択肢もその種類だけにする
  const prompts = props.prompts?.filter((p) => !current.kind || p.kind === current.kind)
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
      {prompts && (
        <>
          <PromptSelect
            prompts={prompts}
            value={current.q ?? ''}
            hrefs={Object.fromEntries([
              ['', filterHref(path, current, { q: undefined })],
              ...prompts.map((p) => [p.id, filterHref(path, current, { q: p.id })]),
            ])}
          />
          <Segmented label="種類">
            {KINDS.map((kind) => (
              <Segment
                key={kind.label}
                // 種類を変えたら質問の選択は外す（別の種類の質問が残ると、結果が空になる）
                href={filterHref(path, current, { kind: kind.value, q: undefined })}
                active={current.kind === kind.value}
              >
                {kind.label}
              </Segment>
            ))}
          </Segmented>
        </>
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
