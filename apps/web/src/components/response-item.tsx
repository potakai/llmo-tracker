import { HighlightedAnswer } from './highlighted-answer'
import { PROVIDER_LABEL } from './labels'

const SENTIMENT_LABEL = { positive: '好意的', neutral: '中立', negative: '否定的' } as const

/** 回答 1 件の表示に必要なもの（実行の詳細と、質問の詳細の両方で使う） */
export type ResponseView = {
  id: string
  provider: 'openai' | 'gemini'
  sampleIndex: number
  status: 'succeeded' | 'failed'
  model: string
  answerText: string | null
  error: string | null
  latencyMs: number | null
  analysis: { extractorModel: string; sentiment: 'positive' | 'neutral' | 'negative' | null } | null
  mentions: {
    id: string
    rank: number
    name: string
    entityType: 'brand' | 'competitor' | 'unknown'
  }[]
  citations: {
    id: string
    url: string
    title: string | null
    domain: string
    isOwnDomain: boolean
  }[]
}

/**
 * 回答 1 行。閉じた状態で「自社が何番目か」と登場した名前の並びを見せ、
 * 開くと回答の本文（名前に色付き）と引用元が見られる。
 * label を渡すと「ChatGPT 1回目」の代わりに使う（質問の詳細では日付を出すため）。
 */
export function ResponseItem({ response: r, label }: { response: ResponseView; label?: string }) {
  const title = label ?? `${PROVIDER_LABEL[r.provider]} ${r.sampleIndex + 1}回目`
  const providerColor = r.provider === 'openai' ? 'text-openai' : 'text-gemini'

  if (r.status === 'failed') {
    return (
      <div className="flex flex-wrap gap-x-4 px-4 py-3 text-sm">
        <span className={`font-bold ${providerColor}`}>{title}</span>
        <span className="text-danger">失敗：{r.error}</span>
      </div>
    )
  }

  const brandMention = r.mentions.find((m) => m.entityType === 'brand')
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-paper focus-visible:bg-paper">
        <span className={`w-36 shrink-0 font-bold ${providerColor}`}>{title}</span>
        <span className="w-32 shrink-0">
          {brandMention ? (
            <span className="font-bold">自社 {brandMention.rank} 番目</span>
          ) : (
            <span className="text-ink-soft">自社は出てこない</span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {r.mentions.map((m) => (
            <span
              key={m.id}
              className={`rounded-sm px-1.5 text-xs ${
                m.entityType === 'brand'
                  ? 'bg-own-soft'
                  : m.entityType === 'competitor'
                    ? 'bg-rival-soft'
                    : 'border border-dashed border-rule'
              }`}
            >
              {m.rank}. {m.name}
            </span>
          ))}
        </span>
        <span
          className="text-ink-soft transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          ›
        </span>
      </summary>
      <div className="grid gap-6 border-t border-rule bg-paper/50 px-4 py-4 md:grid-cols-[1fr_16rem]">
        <div className="max-w-[42em] text-[0.95rem]">
          <HighlightedAnswer text={r.answerText ?? ''} marks={r.mentions} />
        </div>
        <aside className="min-w-0 text-sm">
          <h3 className="font-bold">引用されたページ</h3>
          {r.citations.length === 0 ? (
            <p className="text-ink-soft">なし</p>
          ) : (
            <ol className="mt-1 flex flex-col gap-1">
              {r.citations.map((c) => (
                <li key={c.id} className="truncate">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    {c.title ?? c.domain}
                  </a>
                  {c.isOwnDomain && <span className="ml-1 text-xs">（自社）</span>}
                </li>
              ))}
            </ol>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-1 text-ink-soft">
            <dt>モデル</dt>
            <dd className="truncate">{r.model}</dd>
            <dt>抽出</dt>
            <dd className="truncate">{r.analysis?.extractorModel ?? '未分析'}</dd>
            <dt>言い回し</dt>
            <dd>{r.analysis?.sentiment ? SENTIMENT_LABEL[r.analysis.sentiment] : '—'}</dd>
            <dt>時間</dt>
            <dd className="num">{r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)} 秒` : '—'}</dd>
          </dl>
        </aside>
      </div>
    </details>
  )
}

/** 色の意味の凡例 */
export function MarkLegend() {
  return (
    <ul className="flex flex-wrap gap-4 text-sm">
      <li>
        <mark className="bg-own-soft px-1 text-ink shadow-[inset_0_-0.45em_0_var(--color-own)]">
          自社
        </mark>
      </li>
      <li>
        <mark className="bg-rival-soft px-1 text-ink">登録した競合</mark>
      </li>
      <li>
        <span className="underline decoration-dotted underline-offset-4">未登録の会社</span>
      </li>
    </ul>
  )
}
