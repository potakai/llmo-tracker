import { CHECK_STATUS_LABEL } from './site-audit-labels'

type Status = keyof typeof CHECK_STATUS_LABEL

const STYLE: Record<Status, string> = {
  critical: 'bg-danger text-white',
  warning: 'bg-own-soft text-ink',
  ok: 'border border-rule text-openai',
}

/** 診断の項目の結果（要対応・注意・問題なし） */
export function CheckStatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block shrink-0 self-start rounded px-2 py-0.5 text-xs font-bold whitespace-nowrap ${STYLE[status]}`}
    >
      {CHECK_STATUS_LABEL[status]}
    </span>
  )
}
