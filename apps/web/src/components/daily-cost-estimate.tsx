import {
  type AnswerCosts,
  estimateDailyRunCostUsd,
  formatUsd,
  freeSearchTierNotes,
} from '@/lib/daily-cost'
import { PROVIDER_LABEL, type ProviderKey } from './labels'

/**
 * 「毎朝の計測 1 回あたりの費用の目安」。本物の AI で計測する組織にだけ出す。
 * 入力に合わせて変わるように、計算はその場でする。
 * ふだんの額は検索の無料枠に収まる前提なので、無料枠を超えたときの額も注記で出す
 */
export function DailyCostEstimate(props: {
  samplesPerPrompt: number
  promptCount: number
  providers: readonly ProviderKey[]
  costs: AnswerCosts
}) {
  const { costs, ...run } = props
  const cost = estimateDailyRunCostUsd({ ...run, perAnswerUsd: costs.perAnswerUsd })
  const notes = freeSearchTierNotes({ ...run, costs })
  const providers = props.providers.map((p) => PROVIDER_LABEL[p]).join('・') || 'AI なし'
  const freeSearches = costs.freeSearchesPerMonth.toLocaleString('ja-JP')
  return (
    <div className="rounded-[var(--radius-box)] border border-rule bg-surface px-4 py-3 text-sm">
      <p>
        毎朝の計測 1 回あたりの費用の目安：
        <strong className="num">{cost === null ? '不明' : `約 ${formatUsd(cost)}`}</strong>
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        {props.samplesPerPrompt} 回 × 質問 {props.promptCount} 個 × {providers}
        の、本番の計測の実際の請求から出した 1 回答あたりの目安で計算しています。本物の AI
        で計測するので、API の費用がかかります。
        {cost === null && '料金表にないモデルがあるため、金額を出せません。'}
      </p>
      {notes.map((note) => (
        <p key={note.provider} className="mt-1 text-xs text-ink-soft">
          {PROVIDER_LABEL[note.provider]} の検索が月 {freeSearches} 回（無料枠）を超えると、1
          回答あたり約 {formatUsd(note.perAnswerUsd)} に上がります
          {note.dailyUsd !== null && `（毎朝の計測 1 回あたり約 ${formatUsd(note.dailyUsd)}）`}。
        </p>
      ))}
    </div>
  )
}
