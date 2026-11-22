import { estimateDailyRunCostUsd, formatUsd } from '@/lib/daily-cost'
import { PROVIDER_LABEL, type ProviderKey } from './labels'

/**
 * 「毎朝の計測 1 回あたりの費用の目安」。本物の AI で計測する組織にだけ出す。
 * 入力に合わせて変わるように、計算はその場でする
 */
export function DailyCostEstimate(props: {
  samplesPerPrompt: number
  promptCount: number
  providers: readonly ProviderKey[]
  perAnswerUsd: Record<ProviderKey, number | null>
}) {
  const cost = estimateDailyRunCostUsd(props)
  const providers = props.providers.map((p) => PROVIDER_LABEL[p]).join('・') || 'AI なし'
  return (
    <p className="rounded-[var(--radius-box)] border border-rule bg-surface px-4 py-3 text-sm">
      毎朝の計測 1 回あたりの費用の目安：
      <strong className="num">{cost === null ? '不明' : formatUsd(cost)}</strong>
      <span className="block text-xs text-ink-soft">
        {props.samplesPerPrompt} 回 × 質問 {props.promptCount} 個 × {providers}{' '}
        の回答の目安から計算しています。本物の AI で計測するので、API の費用がかかります。
        {cost === null && '料金表にないモデルがあるため、金額を出せません。'}
      </span>
    </p>
  )
}
