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
