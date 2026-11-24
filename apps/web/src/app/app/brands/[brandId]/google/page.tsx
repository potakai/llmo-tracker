import Link from 'next/link'
import { PROVIDER_LABEL, percent } from '@/components/labels'
import { getSerpPolicy } from '@/lib/serp'
import { competitorRankState, type RankState } from '@/lib/serp-rank'
import { loadBrandForPage } from '@/server/brand-page'
import { getSerpComparison, type SerpComparisonRow, type SerpRow } from '@/server/queries/serp'

type Competitor = { id: string; name: string; domain: string | null }

/**
 * Google との比較：キーワードの質問ごとに、Google の検索順位と「AI による概要」、ChatGPT / Gemini を並べる。
 * ブランドの切り替えで選んでいるブランドの、キーワードの質問だけを出す
 */
export default async function GooglePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { organizationId, brand, isDemo, llmMode } = await loadBrandForPage((await params).brandId)
  const serpMode = getSerpPolicy().modeFor(organizationId)
  const { windowDays, rows } = await getSerpComparison(organizationId, brand.id, {
    serpMode,
    llmMode,
  })
  const settingsHref = `/app/brands/${brand.id}/settings`

  return (
    <div className="flex flex-col gap-6">
      <section className="max-w-3xl">
        <h2 className="text-xl font-bold">Google との比較</h2>
        <p className="mt-2 leading-relaxed">
          キーワードの質問ごとに、Google の検索順位と「Google の AI
          による概要」に御社が出ているかを、ChatGPT・Gemini の結果と並べました。Google は毎朝 1
          回検索し、直近{windowDays}
          日でいちばん新しい日の結果を出しています。
        </p>
      </section>

      {!isDemo && serpMode === 'fake' && (
        <p className="rounded-[var(--radius-box)] border border-rule bg-surface px-4 py-3 text-sm">
          この組織の Google の結果は<strong>サンプル</strong>
          です。実際には Google を検索しておらず、順位と AI による概要は動作確認用の作り物です。
        </p>
      )}

      <DomainNotice
        brandDomain={brand.domain}
        competitors={brand.competitors}
        settingsHref={settingsHref}
      />

      {rows.length === 0 ? (
        <p className="max-w-3xl leading-relaxed">
          キーワードの質問がまだありません。
          <Link href={settingsHref} className="underline underline-offset-4">
            設定
          </Link>
          で、種類が「キーワード」の質問を追加すると、Google での結果を毎朝取ります。
        </p>
      ) : (
        <ComparisonTable
          rows={rows}
          competitors={brand.competitors}
          brandHasDomain={brand.domain !== null}
        />
      )}

      <p className="max-w-3xl text-xs leading-relaxed text-ink-soft">
        検索順位は、日本の Google（パソコン）での通常の検索結果の順位で、上位 10
        位まで見ています。「AI による概要」は、検索結果の上に出る AI
        のまとめです。名前が出たかどうかは、AI の回答と同じ方法で判定しています。
      </p>
    </div>
  )
}

function DomainNotice(props: {
  brandDomain: string | null
  competitors: Competitor[]
  settingsHref: string
}) {
  const missing = props.competitors.filter((c) => !c.domain).map((c) => c.name)
  if (props.brandDomain && missing.length === 0) return null
  return (
    <div className="rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm leading-relaxed">
      {!props.brandDomain && (
        <p>御社のサイトのドメインが設定されていないため、Google の検索順位を出せません。</p>
      )}
      {missing.length > 0 && (
        <p>
          ドメインが設定されていない競合（{missing.join('、')}
          ）は、検索順位を出せません。設定の「競合」で、各社の「編集」から入れられます。
        </p>
      )}
      <p>
        <Link href={props.settingsHref} className="font-bold underline underline-offset-4">
          設定
        </Link>
        でドメイン（例：example.co.jp）を登録してください。
      </p>
    </div>
  )
}

function ComparisonTable(props: {
  rows: SerpComparisonRow[]
  competitors: Competitor[]
  brandHasDomain: boolean
}) {
  const { rows, competitors, brandHasDomain } = props
  return (
    <div className="overflow-x-auto rounded-[var(--radius-box)] border border-rule bg-surface">
      <table className="w-full text-left text-sm" aria-label="Google との比較">
        <thead className="border-b border-rule text-ink-soft">
          <tr>
            <th className="px-4 py-2 font-medium">キーワード</th>
            <th className="px-4 py-2 text-right font-medium">Google の検索順位（御社）</th>
            {competitors.map((c) => (
              <th key={c.id} className="px-4 py-2 text-right font-medium">
                {c.name}の順位
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Google の AI による概要</th>
            <th className="px-4 py-2 font-medium">AI による概要に出た名前</th>
            {(['openai', 'gemini'] as const).map((p) => (
              <th key={p} className="px-4 py-2 text-right font-medium">
                {PROVIDER_LABEL[p]}で名前が出た割合
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((row) => (
            <tr key={row.promptId}>
              <td className="px-4 py-2">
                {row.text}
                {row.serp && (
                  <span className="num block text-xs text-ink-soft">
                    {row.serp.searchedOn} の検索結果
                  </span>
                )}
              </td>
              {row.serp ? (
                <SerpCells
                  serp={row.serp}
                  competitors={competitors}
                  brandHasDomain={brandHasDomain}
                />
              ) : (
                <td colSpan={competitors.length + 3} className="px-4 py-2 text-ink-soft">
                  まだ結果がありません（毎朝取ります）
                </td>
              )}
              {(['openai', 'gemini'] as const).map((p) => (
                <td key={p} className="num px-4 py-2 text-right">
                  {percent(row.ai[p].rate)}
                  <span className="block text-xs text-ink-soft">{row.ai[p].n} 回答</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SerpCells(props: { serp: SerpRow; competitors: Competitor[]; brandHasDomain: boolean }) {
  const { serp, competitors } = props
  const names = [
    ...(serp.brandInAiOverview ? ['御社'] : []),
    ...competitors.filter((c) => serp.competitorsInAiOverview.includes(c.id)).map((c) => c.name),
  ]
  return (
    <>
      <RankCell state={brandRankState(props.brandHasDomain, serp.brandRank)} isOwn />
      {competitors.map((c) => (
        <RankCell key={c.id} state={competitorRankState(serp.competitorRanks, c)} />
      ))}
      <td className="px-4 py-2">
        {serp.aiOverviewPresent ? '出た' : '出なかった'}
        {serp.aiOverviewAsynchronous && (
          <span className="block text-xs text-ink-soft">あとから表示されるタイプ</span>
        )}
      </td>
      <td className="px-4 py-2">
        {!serp.aiOverviewPresent ? (
          <span className="text-ink-soft">—</span>
        ) : names.length > 0 ? (
          names.join('、')
        ) : (
          <span className="text-ink-soft">御社・競合とも出なかった</span>
        )}
      </td>
    </>
  )
}

/** 自社の順位の状態。自社の行は結果を保存するときに必ず作るので、未計測はない */
function brandRankState(hasDomain: boolean, rank: number | null): RankState {
  if (!hasDomain) return { kind: 'noDomain' }
  return rank === null ? { kind: 'outOfRange' } : { kind: 'ranked', rank }
}

/** 順位のセル */
function RankCell({ state, isOwn = false }: { state: RankState; isOwn?: boolean }) {
  return (
    <td className={`num px-4 py-2 text-right ${isOwn ? 'font-bold' : ''}`}>
      <RankText state={state} />
    </td>
  )
}

function RankText({ state }: { state: RankState }) {
  switch (state.kind) {
    case 'noDomain':
      return <span className="text-xs text-ink-soft">ドメイン未設定</span>
    case 'notMeasured':
      return (
        <span className="text-ink-soft">
          未計測
          <span className="block text-xs">次の検索から順位が出ます</span>
        </span>
      )
    case 'outOfRange':
      return <span className="text-ink-soft">圏外（11位以下）</span>
    case 'ranked':
      return `${state.rank}位`
  }
}
