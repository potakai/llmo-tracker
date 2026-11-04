import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FilterBar } from '@/components/filter-bar'
import { formatDate, PROVIDER_LABEL, percent } from '@/components/labels'
import { MarkLegend, ResponseItem } from '@/components/response-item'
import { ShareOfVoice } from '@/components/share-of-voice'
import { TrendChart } from '@/components/trend-chart'
import { filterHref, parseFilter } from '@/lib/filters'
import { toTrendRows } from '@/lib/trend'
import { loadBrandForPage } from '@/server/brand-page'
import { getBrandMetrics } from '@/server/queries/metrics'
import { findPromptInBrand, listPromptResponses } from '@/server/queries/prompts'
import { promptParams } from '@/server/schemas/brand'

/** 質問 1 つの詳細：推移・誰が出ているか・最近の回答そのもの */
export default async function PromptPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; promptId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await params
  const { brand } = await loadBrandForPage(raw.brandId)
  const parsed = promptParams.safeParse(raw)
  if (!parsed.success) notFound()
  const found = await findPromptInBrand(brand.id, parsed.data.promptId)
  if (!found) notFound()

  const filter = { ...parseFilter(await searchParams), q: undefined }
  const [metrics, responses] = await Promise.all([
    getBrandMetrics(brand.id, { days: filter.days, provider: filter.ai, promptId: found.id }),
    listPromptResponses(found.id, { provider: filter.ai, limit: 30 }),
  ])
  const latest = metrics.latest
  const path = `/app/brands/${brand.id}/prompts/${found.id}`

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <Link
          href={filterHref(`/app/brands/${brand.id}`, filter, {})}
          className="self-start text-sm underline underline-offset-4"
        >
          計測結果に戻る
        </Link>
        <div>
          <p className="text-sm text-ink-soft">
            質問{found.archivedAt && '（アーカイブ済み。今は計測していません）'}
          </p>
          <h2 className="text-xl font-bold">「{found.text}」</h2>
        </div>
        {latest && latest.n > 0 ? (
          <p className="phrase max-w-3xl text-lg leading-relaxed">
            直近7日、{filter.ai ? PROVIDER_LABEL[filter.ai] : 'AI'} の回答{' '}
            <span className="num font-bold">{latest.n}</span> 件のうち{' '}
            <span className="num bg-own-soft px-1 font-bold shadow-[inset_0_-0.4em_0_var(--color-own)]">
              {percent(latest.rate)}
            </span>{' '}
            に「{brand.name}」が出てきました（95%の範囲は{' '}
            <span className="num">
              {percent(latest.low)}〜{percent(latest.high)}
            </span>
            ）。
          </p>
        ) : (
          <p className="text-lg">直近7日、この質問への回答はまだありません。</p>
        )}
        <FilterBar path={path} current={filter} />
      </section>

      <section className="panel p-5" aria-labelledby="prompt-trend-heading">
        <h2 id="prompt-trend-heading" className="font-bold">
          この質問での言及率の推移
        </h2>
        <div className="mt-4">
          <TrendChart rows={toTrendRows(metrics)} />
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="prompt-sov-heading">
        <h2 id="prompt-sov-heading" className="font-bold">
          この質問で名前を挙げられているのは
        </h2>
        <p className="mb-4 text-sm text-ink-soft">直近7日の回答 {metrics.windowTotal} 件のうち</p>
        <ShareOfVoice entities={metrics.shareOfVoice} />
      </section>

      <section aria-labelledby="answers-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="answers-heading" className="font-bold">
            最近の回答（新しい順に {responses.length} 件）
          </h2>
          <MarkLegend />
        </div>
        {responses.length === 0 ? (
          <p className="text-sm text-ink-soft">まだ回答がありません。</p>
        ) : (
          <ul className="panel divide-y divide-rule">
            {responses.map((r) => (
              <li key={r.id}>
                <ResponseItem
                  response={r}
                  label={`${r.run.scheduledFor ?? formatDate(r.run.createdAt)} ${PROVIDER_LABEL[r.provider]}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
