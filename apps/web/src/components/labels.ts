export const PROVIDER_LABEL = { openai: 'ChatGPT', gemini: 'Gemini' } as const
export type ProviderKey = keyof typeof PROVIDER_LABEL

export const RUN_STATUS_LABEL = {
  queued: '待機中',
  running: '計測中',
  succeeded: '完了',
  partial: '一部失敗',
  failed: '失敗',
} as const

export const percent = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`

export const formatDate = (iso: string | Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/** 「費用の目安」に添える注記。トークン数と検索回数から計算した見積もりで、請求額そのものではない */
export const COST_ESTIMATE_NOTE =
  '費用の目安は、トークン数と検索回数から料金表で計算した見積もりです。実際の請求額とは異なることがあります。'
