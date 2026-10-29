import type { BrandMetrics } from '@/server/queries/metrics'
import { percent } from './labels'

const BAR: Record<string, string> = {
  brand: 'bg-own',
  competitor: 'bg-[#9cc3ec]',
  unknown: 'bg-rule',
}

/**
 * 名前ごとの言及率。棒が言及率、細い線が 95% 信頼区間。
 * 線が重なっている同士は「差があるとはまだ言えない」。
 */
export function ShareOfVoice({ entities }: { entities: BrandMetrics['shareOfVoice'] }) {
  if (entities.length === 0) {
    return <p className="text-sm text-ink-soft">まだ回答がありません。</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {entities.map((e) => (
        <li key={`${e.entityType}:${e.name}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={e.entityType === 'brand' ? 'font-bold' : ''}>
              {e.name}
              {e.entityType === 'unknown' && (
                <span className="ml-2 text-xs text-ink-soft">未登録</span>
              )}
            </span>
            <span className="num shrink-0">
              {percent(e.rate)}
              <span className="ml-2 text-xs text-ink-soft">平均 {e.avgRank} 番目</span>
            </span>
          </div>
          <div className="relative mt-1 h-2.5 rounded-full bg-paper" aria-hidden="true">
            <div
              className={`h-full rounded-full ${BAR[e.entityType]}`}
              style={{ width: `${(e.rate ?? 0) * 100}%` }}
            />
            {e.low !== null && e.high !== null && (
              <div
                className="absolute top-1/2 h-px bg-ink"
                style={{ left: `${e.low * 100}%`, width: `${(e.high - e.low) * 100}%` }}
              >
                <span className="absolute -top-1 left-0 h-2 w-px bg-ink" />
                <span className="absolute -top-1 right-0 h-2 w-px bg-ink" />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
