import Link from 'next/link'
import { FilterBar } from '@/components/filter-bar'
import { formatDate, PROVIDER_LABEL, percent, RUN_STATUS_LABEL } from '@/components/labels'
import { RunButton } from '@/components/run-button'
import { ShareOfVoice } from '@/components/share-of-voice'
import { TrendChart } from '@/components/trend-chart'
import { filterHref, parseFilter } from '@/lib/filters'
import { toTrendRows } from '@/lib/trend'
import { loadBrandForPage } from '@/server/brand-page'
import { getBrandMetrics } from '@/server/queries/metrics'
import { listRuns } from '@/server/queries/runs'

export default async function BrandDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { brand, isDemo } = await loadBrandForPage((await params).brandId)
  const filter = parseFilter(await searchParams)
  const [metrics, runs] = await Promise.all([
    getBrandMetrics(brand.id, { days: filter.days, provider: filter.ai, promptId: filter.q }),
    listRuns(brand.id, 10),
  ])

  const path = `/app/brands/${brand.id}`
  const activeRun = runs.find((r) => r.status === 'queued' || r.status === 'running')
  const expected = brand.prompts.length * brand.providers.length * brand.samplesPerPrompt
  const latest = metrics.latest
  const selectedPrompt = filter.q ? brand.prompts.find((p) => p.id === filter.q) : undefined
  const scope = [
    filter.ai ? PROVIDER_LABEL[filter.ai] : null,
    selectedPrompt ? `「${selectedPrompt.text}」` : null,
  ]
    .filter(Boolean)
    .join('・')

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            {latest && latest.n > 0 ? (
              <>
                <p className="phrase text-xl leading-relaxed md:text-2xl">
                  直近7日、{scope ? `${scope}の` : 'AI の'}回答{' '}
                  <span className="num font-bold">{latest.n}</span> 件のうち{' '}
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
                  のあいだです（95%）。
                  {!filter.ai && (
                    <>
                      内訳は{' '}
                      <span className="num text-openai">
                        ChatGPT {percent(metrics.trend.openai.at(-1)?.rate)}
                      </span>
                      、
                      <span className="num text-gemini">
                        Gemini {percent(metrics.trend.gemini.at(-1)?.rate)}
                      </span>
                      。
                    </>
                  )}
                </p>
              </>
            ) : runs.length === 0 ? (
              <p className="text-lg">
                まだ計測していません。「今すぐ計測」を押すと、登録した {brand.prompts.length}{' '}
                個の質問を AI に聞いて、ここに結果が出ます。
              </p>
            ) : (
              <p className="text-lg">
                この条件では、直近7日の回答がありません。期間や絞り込みを変えてみてください。
              </p>
            )}
          </div>
          <RunButton
            brandId={brand.id}
            running={activeRun !== undefined}
            disabledReason={isDemo ? 'デモでは計測できません' : undefined}
          />
        </div>

        {activeRun && (
          <div className="panel flex flex-col gap-2 px-4 py-3" role="status">
            <p className="text-sm">
              {RUN_STATUS_LABEL[activeRun.status]}：AI の回答{' '}
              <span className="num">
                {activeRun.succeeded + activeRun.failed} / {expected}
              </span>{' '}
              件
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
              <div
                className="h-full bg-gemini transition-[width]"
                style={{
                  width: `${expected === 0 ? 0 : ((activeRun.succeeded + activeRun.failed) / expected) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <FilterBar
          path={path}
          current={filter}
          prompts={brand.prompts.map((p) => ({ id: p.id, text: p.text }))}
        />
      </section>

      <section className="panel p-5" aria-labelledby="trend-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trend-heading" className="font-bold">
            言及率の推移（直近7日ずつまとめた値）
          </h2>
          <TrendLegend showProviders={!filter.ai} />
        </div>
        <div className="mt-4">
          <TrendChart rows={toTrendRows(metrics)} />
        </div>
      </section>

      {!filter.q && metrics.byPrompt.length > 0 && (
        <section aria-labelledby="prompts-heading">
          <h2 id="prompts-heading" className="font-bold">
            質問ごとの結果
          </h2>
          <p className="mb-3 text-sm text-ink-soft">
            直近7日。質問を選ぶと、推移と実際の回答が見られます
          </p>
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="whitespace-nowrap border-b border-rule text-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-medium">質問</th>
                  <th className="px-4 py-2 text-right font-medium">言及率</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                    95%の範囲
                  </th>
                  {!filter.ai && (
                    <>
                      <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                        ChatGPT
                      </th>
                      <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                        Gemini
                      </th>
                    </>
                  )}
                  <th className="px-4 py-2 text-right font-medium">回答</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {metrics.byPrompt.map((p) => (
                  <tr key={p.promptId}>
                    <td className="px-4 py-2">
                      <Link
                        href={filterHref(`${path}/prompts/${p.promptId}`, filter, { q: undefined })}
                        className="underline underline-offset-4"
                      >
                        {p.text}
                      </Link>
                      {p.archived && (
                        <span className="ml-2 text-xs text-ink-soft">アーカイブ済み</span>
                      )}
                    </td>
                    <td className="num px-4 py-2 text-right font-bold">{percent(p.rate)}</td>
                    <td className="num hidden px-4 py-2 text-right text-ink-soft sm:table-cell">
                      {percent(p.low)}〜{percent(p.high)}
                    </td>
                    {!filter.ai && (
                      <>
                        <td className="num hidden px-4 py-2 text-right text-openai md:table-cell">
                          {percent(p.openai)}
                        </td>
                        <td className="num hidden px-4 py-2 text-right text-gemini md:table-cell">
                          {percent(p.gemini)}
                        </td>
                      </>
                    )}
                    <td className="num px-4 py-2 text-right text-ink-soft">{p.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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

      <RunHistory brandId={brand.id} runs={runs} />

      <p className="text-xs leading-relaxed text-ink-soft">
        数字は、API 経由で AI に質問した回答から出した定点観測の目安です。ChatGPT や Gemini
        のアプリで人が見る回答（検索の有無、履歴、地域などで変わる）と同じとは限りません。「名前が出た」「おすすめされた」「自社サイトが引用された」は、それぞれ別の指標として見てください。
      </p>
    </div>
  )
}

function TrendLegend({ showProviders }: { showProviders: boolean }) {
  return (
    <ul className="flex flex-wrap gap-4 text-sm">
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 bg-ink" aria-hidden="true" />
        {showProviders ? '全体' : '言及率'}
      </li>
      {showProviders && (
        <>
          <li className="flex items-center gap-1.5 text-openai">
            <span className="h-0.5 w-4 bg-openai" aria-hidden="true" />
            ChatGPT
          </li>
          <li className="flex items-center gap-1.5 text-gemini">
            <span className="h-0.5 w-4 bg-gemini" aria-hidden="true" />
            Gemini
          </li>
        </>
      )}
      <li className="flex items-center gap-1.5 text-ink-soft">
        <span className="h-3 w-4 bg-ink/10" aria-hidden="true" />
        95%の範囲
      </li>
    </ul>
  )
}

function RunHistory({
  brandId,
  runs,
}: {
  brandId: string
  runs: Awaited<ReturnType<typeof listRuns>>
}) {
  return (
    <section aria-labelledby="runs-heading">
      <h2 id="runs-heading" className="mb-3 font-bold">
        計測の履歴
      </h2>
      {runs.length === 0 ? (
        <p className="text-sm text-ink-soft">まだ計測していません。</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="whitespace-nowrap border-b border-rule text-ink-soft">
              <tr>
                <th className="px-4 py-2 font-medium">日時</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">きっかけ</th>
                <th className="px-4 py-2 font-medium">状態</th>
                <th className="px-4 py-2 text-right font-medium">回答</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                  費用の目安
                </th>
                <th className="px-4 py-2">
                  <span className="sr-only">詳細</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="num px-4 py-2">{r.scheduledFor ?? formatDate(r.createdAt)}</td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    {r.trigger === 'scheduled' ? '毎日の自動' : '手動'}
                  </td>
                  <td
                    className={`px-4 py-2 ${r.status === 'failed' || r.status === 'partial' ? 'text-danger' : ''}`}
                  >
                    {RUN_STATUS_LABEL[r.status]}
                  </td>
                  <td className="num px-4 py-2 text-right">
                    {r.succeeded}
                    {r.failed > 0 && <span className="text-danger">（失敗 {r.failed}）</span>}
                  </td>
                  <td className="num hidden px-4 py-2 text-right sm:table-cell">
                    ${r.totalCostUsd.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/app/brands/${brandId}/runs/${r.id}`}
                      className="whitespace-nowrap underline underline-offset-4"
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
  )
}
