import { type AnswerCosts, estimateDailyRunCostRange, formatUsd } from '@/lib/daily-cost'
import { PROVIDER_LABEL, type ProviderKey } from './labels'

const usdOrUnknown = (usd: number | null) => (usd === null ? '不明' : `約 ${formatUsd(usd)}`)

/**
 * 「毎朝の計測 1 回あたりの費用の目安」。本物の AI で計測する組織にだけ出す。
 * 入力に合わせて変わるように、計算はその場でする。
 * Gemini を計測するときは、検索の無料枠が残っている場合と使い切った場合の両方の額を並べる
 */
export function DailyCostEstimate(props: {
  samplesPerPrompt: number
  promptCount: number
  providers: readonly ProviderKey[]
  costs: AnswerCosts
}) {
  const range = estimateDailyRunCostRange(props)
  const providers = props.providers.map((p) => PROVIDER_LABEL[p]).join('・') || 'AI なし'
  const freeSearches = props.costs.freeSearchesPerMonth.toLocaleString('ja-JP')
  const isUnknown = range.withinFreeSearches === null || range.beyondFreeSearches === null
  return (
    <div className="rounded-[var(--radius-box)] border border-rule bg-surface px-4 py-3 text-sm">
      <p>毎朝の計測 1 回あたりの費用の目安</p>
      {range.dependsOnFreeSearches ? (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>Gemini の検索の無料枠（月 {freeSearches} 回）が残っている場合</dt>
          <dd className="num font-bold">{usdOrUnknown(range.withinFreeSearches)}</dd>
          <dt>無料枠を使い切った場合</dt>
          <dd className="num font-bold">{usdOrUnknown(range.beyondFreeSearches)}</dd>
        </dl>
      ) : (
        <p className="num mt-1 font-bold">{usdOrUnknown(range.withinFreeSearches)}</p>
      )}
      <p className="mt-2 text-xs text-ink-soft">
        {props.samplesPerPrompt} 回 × 質問 {props.promptCount} 個 × {providers}
        の、本番の計測の実際の請求から出した 1 回答あたりの目安で計算しています。本物の AI
        で計測するので、API の費用がかかります。
        {range.dependsOnFreeSearches &&
          `Gemini の検索の無料枠は、このアプリ全体（すべてのブランド）で共有しています。ほかのブランドの計測でも減るので、月の途中で使い切ることがあります。`}
        {isUnknown && '料金表にないモデルがあるため、金額を出せないものがあります。'}
      </p>
    </div>
  )
}
