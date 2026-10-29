import Link from 'next/link'
import { formatDate, percent, RUN_STATUS_LABEL } from '@/components/labels'
import { RunButton } from '@/components/run-button'
import { ShareOfVoice } from '@/components/share-of-voice'
import { TrendChart, type TrendRow } from '@/components/trend-chart'
import { loadBrandForPage } from '@/server/brand-page'
import { getBrandMetrics } from '@/server/queries/metrics'
import { listRuns } from '@/server/queries/runs'

const toPct = (v: number | null) => (v === null ? null : v * 100)

export default async function BrandDashboard({ params }: { params: Promise<{ brandId: string }> }) {
  const brand = await loadBrandForPage((await params).brandId)
  const [metrics, runs] = await Promise.all([getBrandMetrics(brand.id), listRuns(brand.id, 10)])
  const running = runs.some((r) => r.status === 'queued' || r.status === 'running')

  const rows: TrendRow[] = metrics.trend.all.map((point, i) => ({
    date: point.date,
    all: toPct(point.rate),
    band: point.low === null || point.high === null ? null : [point.low * 100, point.high * 100],
    openai: toPct(metrics.trend.openai[i]?.rate ?? null),
    gemini: toPct(metrics.trend.gemini[i]?.rate ?? null),
    n: point.n,
  }))
  const latest = metrics.latest
  const latestOpenai = metrics.trend.openai.at(-1)
  const latestGemini = metrics.trend.gemini.at(-1)

  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">計測しているブランド</p>
            <h1 className="text-2xl font-bold">{brand.name}</h1>
          </div>
          <RunButton brandId={brand.id} running={running} />
        </div>

        {latest && latest.n > 0 ? (
          <div className="mt-6 max-w-3xl">
            <p className="phrase text-xl leading-relaxed md:text-2xl">
              直近7日、AI の回答 <span className="num font-bold">{latest.n}</span> 件のうち{' '}
              <span className="num bg-own-soft px-1 font-bold shadow-[inset_0_-0.4em_0_var(--color-own)]">
                {percent(latest.rate)}
              </span>{' '}
              に「{brand.name}」が出てきました。
            </p>
            <p className="mt-2 text-ink-soft">
              本当の割合は、おそらく{' '}
              <span className="num">
                {percent(latest.low)}〜{percent(latest.high)}
              </span>{' '}
              のあいだです（95%）。内訳は{' '}
              <span className="num text-openai">ChatGPT {percent(latestOpenai?.rate)}</span>、
              <span className="num text-gemini">Gemini {percent(latestGemini?.rate)}</span>。
            </p>
          </div>
        ) : (
          <p className="mt-6 max-w-3xl text-lg">
            まだ計測した回答がありません。「今すぐ計測」を押すと、登録した {brand.prompts.length}{' '}
            個の質問を AI に聞いて、ここに結果が出ます。
          </p>
        )}
      </section>

      <section className="panel p-5" aria-labelledby="trend-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trend-heading" className="font-bold">
            言及率の推移（直近7日ずつまとめた値）
          </h2>
          <ul className="flex gap-4 text-sm">
            <li className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-ink" aria-hidden="true" />
              全体
            </li>
            <li className="flex items-center gap-1.5 text-openai">
              <span className="h-0.5 w-4 bg-openai" aria-hidden="true" />
              ChatGPT
            </li>
            <li className="flex items-center gap-1.5 text-gemini">
              <span className="h-0.5 w-4 bg-gemini" aria-hidden="true" />
              Gemini
            </li>
            <li className="flex items-center gap-1.5 text-ink-soft">
              <span className="h-3 w-4 bg-ink/10" aria-hidden="true" />
              95%の範囲
            </li>
          </ul>
        </div>
        <div className="mt-4">
          <TrendChart rows={rows} />
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <section className="panel p-5" aria-labelledby="sov-heading">
          <h2 id="sov-heading" className="font-bold">
            誰が名前を挙げられているか
          </h2>
          <p className="mb-4 text-sm text-ink-soft">
            直近7日の回答 {metrics.windowTotal} 件のうち、それぞれが出てきた割合
          </p>
          <ShareOfVoice entities={metrics.shareOfVoice} />
        </section>

        <section className="panel p-5" aria-labelledby="domain-heading">
          <h2 id="domain-heading" className="font-bold">
            AI がよく引用したサイト
          </h2>
          <p className="mb-4 text-sm text-ink-soft">直近7日の引用回数</p>
          {metrics.topDomains.length === 0 ? (
            <p className="text-sm text-ink-soft">まだ引用がありません。</p>
          ) : (
            <ol className="flex flex-col divide-y divide-rule text-sm">
              {metrics.topDomains.map((d) => (
                <li key={d.domain} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">
                    {d.domain}
                    {d.isOwnDomain && (
                      <span className="ml-2 rounded-sm bg-own-soft px-1.5 text-xs">自社サイト</span>
                    )}
                  </span>
                  <span className="num shrink-0 text-ink-soft">{d.count} 回</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="mb-3 font-bold">
          計測の履歴
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-ink-soft">まだ計測していません。</p>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-rule text-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-medium">日時</th>
                  <th className="px-4 py-2 font-medium">きっかけ</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                  <th className="px-4 py-2 text-right font-medium">回答（成功／失敗）</th>
                  <th className="px-4 py-2 text-right font-medium">費用の目安</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="num px-4 py-2">{r.scheduledFor ?? formatDate(r.createdAt)}</td>
                    <td className="px-4 py-2">
                      {r.trigger === 'scheduled' ? '毎日の自動' : '手動'}
                    </td>
                    <td className={`px-4 py-2 ${r.status === 'failed' ? 'text-danger' : ''}`}>
                      {RUN_STATUS_LABEL[r.status]}
                    </td>
                    <td className="num px-4 py-2 text-right">
                      {r.succeeded}
                      {r.failed > 0 && <span className="text-danger"> ／ {r.failed}</span>}
                    </td>
                    <td className="num px-4 py-2 text-right">${r.totalCostUsd.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/app/brands/${brand.id}/runs/${r.id}`}
                        className="underline underline-offset-4"
                      >
                        回答を見る
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
