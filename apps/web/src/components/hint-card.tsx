import type { DomainCount, Hint } from '@/lib/hints'
import { textFor } from './hint-text'
import { formatDate, PROVIDER_LABEL } from './labels'
import { ResponseItem, type ResponseView } from './response-item'

/** 根拠に出す回答（日付を出すため run の日付つき） */
export type EvidenceResponse = ResponseView & {
  run: { scheduledFor: string | null; createdAt: Date | string }
}

type HintCardProps = {
  hint: Hint
  /** 何番目の施策か（1 始まり） */
  order: number
  brandId: string
  evidence: Map<string, EvidenceResponse>
}

function EvidenceResponses(props: { ids: string[]; evidence: Map<string, EvidenceResponse> }) {
  const responses = props.ids.flatMap((id) => {
    const found = props.evidence.get(id)
    return found ? [found] : []
  })
  if (responses.length === 0) {
    return <p className="px-4 py-3 text-sm text-ink-soft">回答がありません。</p>
  }
  return (
    <ul className="divide-y divide-rule">
      {responses.map((r) => (
        <li key={r.id}>
          <ResponseItem
            response={r}
            label={`${r.run.scheduledFor ?? formatDate(r.run.createdAt)} ${PROVIDER_LABEL[r.provider]}`}
          />
        </li>
      ))}
    </ul>
  )
}

function EvidenceDomains({ domains }: { domains: DomainCount[] }) {
  if (domains.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-ink-soft">参考元が表示された回答は、まだありません。</p>
    )
  }
  return (
    <ol className="flex flex-col divide-y divide-rule px-4 text-sm">
      {domains.map((d) => (
        <li key={d.domain} className="flex items-center justify-between gap-3 py-2">
          <span className="truncate">
            {d.domain}
            {d.isOwn && (
              <span className="ml-2 rounded-sm bg-own-soft px-1.5 text-xs">自社サイト</span>
            )}
          </span>
          <span className="num shrink-0 text-ink-soft">{d.responses} 件の回答</span>
        </li>
      ))}
    </ol>
  )
}

/** 根拠の数（サイトの一覧か、回答の一覧か） */
function evidenceCount(hint: Hint): number {
  return 'evidenceDomains' in hint ? hint.evidenceDomains.length : hint.evidenceResponseIds.length
}

export function HintCard({ hint, order, brandId, evidence }: HintCardProps) {
  const text = textFor(hint, brandId)
  const headingId = `hint-${order}`
  return (
    <article className="panel flex flex-col gap-4 p-5" aria-labelledby={headingId}>
      <h3 id={headingId} className="flex gap-3 text-lg font-bold leading-snug">
        <span className="num shrink-0 text-ink-soft">{order}.</span>
        <span>{text.title}</span>
      </h3>
      <dl className="grid gap-3 text-[0.95rem] leading-relaxed md:grid-cols-[9rem_1fr]">
        <dt className="text-sm font-bold text-ink-soft">何が起きているか</dt>
        <dd>{text.now}</dd>
        <dt className="text-sm font-bold text-ink-soft">なぜ大事か</dt>
        <dd>{text.why}</dd>
        <dt className="text-sm font-bold text-ink-soft">次にできること</dt>
        <dd>{text.next}</dd>
      </dl>
      <details className="group rounded-[var(--radius-box)] border border-rule">
        <summary className="cursor-pointer list-none px-4 py-2 text-sm hover:bg-paper">
          <span
            className="mr-2 inline-block text-ink-soft transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            ›
          </span>
          {text.evidenceLabel}（<span className="num">{evidenceCount(hint)}</span> 件）
        </summary>
        <div className="border-t border-rule">
          {'evidenceDomains' in hint ? (
            <EvidenceDomains domains={hint.evidenceDomains} />
          ) : (
            <EvidenceResponses ids={hint.evidenceResponseIds} evidence={evidence} />
          )}
        </div>
      </details>
    </article>
  )
}
