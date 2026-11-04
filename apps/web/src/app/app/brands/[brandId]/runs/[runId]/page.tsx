import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, RUN_STATUS_LABEL } from '@/components/labels'
import { MarkLegend, ResponseItem } from '@/components/response-item'
import { loadBrandForPage } from '@/server/brand-page'
import { getRunDetail, type RunDetail } from '@/server/queries/runs'
import { runParams } from '@/server/schemas/brand'

type ResponseRow = RunDetail['responses'][number]

export default async function RunPage({
  params,
}: {
  params: Promise<{ brandId: string; runId: string }>
}) {
  const raw = await params
  const { brand } = await loadBrandForPage(raw.brandId)
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
          計測結果に戻る
        </Link>
        <h1 className="mt-3 text-xl font-bold">
          {run.scheduledFor ?? formatDate(run.createdAt)} の計測
        </h1>
        <p className="mt-1 text-ink-soft">
          {run.trigger === 'scheduled' ? '毎日の自動計測' : '手動の計測'}、
          {RUN_STATUS_LABEL[run.status]}。回答 {run.responses.length} 件、費用の目安 $
          {run.totalCostUsd.toFixed(2)}
        </p>
        <div className="mt-4">
          <MarkLegend />
        </div>
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
