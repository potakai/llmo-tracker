import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HighlightedAnswer } from '@/components/highlighted-answer'
import { formatDate, PROVIDER_LABEL, RUN_STATUS_LABEL } from '@/components/labels'
import { loadBrandForPage } from '@/server/brand-page'
import { getRunDetail, type RunDetail } from '@/server/queries/runs'
import { runParams } from '@/server/schemas/brand'

type ResponseRow = RunDetail['responses'][number]

const SENTIMENT_LABEL = { positive: '好意的', neutral: '中立', negative: '否定的' } as const

export default async function RunPage({
  params,
}: {
  params: Promise<{ brandId: string; runId: string }>
}) {
  const raw = await params
  const brand = await loadBrandForPage(raw.brandId)
  const parsed = runParams.safeParse(raw)
  if (!parsed.success) notFound()
  const run = await getRunDetail(brand.id, parsed.data.runId)
  if (!run) notFound()

  // 質問ごとにまとめる（並びは質問の登録順）
  const byPrompt = new Map<string, { text: string; responses: ResponseRow[] }>()
  for (const r of run.responses) {
    const group = byPrompt.get(r.promptId) ?? { text: r.prompt.text, responses: [] }
    group.responses.push(r)
    byPrompt.set(r.promptId, group)
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/app/brands/${brand.id}`} className="text-sm underline underline-offset-4">
          {brand.name} の計測画面に戻る
        </Link>
        <h1 className="mt-3 text-2xl font-bold">
          {run.scheduledFor ?? formatDate(run.createdAt)} の計測
        </h1>
        <p className="mt-1 text-ink-soft">
          {run.trigger === 'scheduled' ? '毎日の自動計測' : '手動の計測'}、
          {RUN_STATUS_LABEL[run.status]}。回答 {run.responses.length} 件、費用の目安 $
          {run.totalCostUsd.toFixed(2)}
        </p>
        <ul className="mt-4 flex flex-wrap gap-4 text-sm">
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
      </div>

      {[...byPrompt.entries()].map(([promptId, group]) => {
        const ok = group.responses.filter((r) => r.status === 'succeeded')
        const mentioned = ok.filter((r) => r.analysis?.brandMentioned).length
        return (
          <section key={promptId} aria-labelledby={`p-${promptId}`}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`p-${promptId}`} className="text-lg font-bold">
                「{group.text}」
              </h2>
              <p className="num text-sm text-ink-soft">
                {ok.length} 回中 {mentioned} 回、自社が出てきた
              </p>
            </div>
            <ul className="panel divide-y divide-rule">
              {group.responses.map((r) => (
                <li key={r.id}>
                  <ResponseItem response={r} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ResponseItem({ response: r }: { response: ResponseRow }) {
  const label = `${PROVIDER_LABEL[r.provider]} ${r.sampleIndex + 1}回目`
  const providerColor = r.provider === 'openai' ? 'text-openai' : 'text-gemini'

  if (r.status === 'failed') {
    return (
      <div className="flex flex-wrap gap-x-4 px-4 py-3 text-sm">
        <span className={`font-bold ${providerColor}`}>{label}</span>
        <span className="text-danger">失敗：{r.error}</span>
      </div>
    )
  }

  const brandMention = r.mentions.find((m) => m.entityType === 'brand')
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-paper">
        <span className={`w-28 shrink-0 font-bold ${providerColor}`}>{label}</span>
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
        <aside className="text-sm">
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
