import Link from 'next/link'
import { SiteAuditButton } from '@/components/site-audit-button'
import { SITE_AUDIT_STATUS_LABEL } from '@/components/site-audit-labels'
import type { SiteAuditState } from '@/server/queries/site-audit'

/** 設定の「サイト診断」：今すぐ診断のボタンと、最新の診断の状態 */
export function SiteAuditSection(props: {
  brandId: string
  domain: string | null
  isDemo: boolean
  state: SiteAuditState
}) {
  const { state } = props
  const disabledReason = props.isDemo
    ? 'デモアカウントでは診断できません'
    : !props.domain
      ? '下のブランド情報で、サイトのドメインを登録すると診断できます'
      : state.manualUsedToday && !state.isRunning
        ? '今すぐ診断は 1 日 1 回までです。明日また押せます'
        : undefined

  return (
    <section aria-labelledby="site-audit-settings-heading">
      <h2 id="site-audit-settings-heading" className="text-lg font-bold">
        サイト診断
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        登録したドメインのサイトを読み、AI
        に拾われやすい作りかを診断します。毎週月曜に自動で診断し、
        すぐに診断したいときは「今すぐ診断」を押してください（1 日 1 回まで）。
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SiteAuditButton
          brandId={props.brandId}
          running={state.isRunning}
          disabledReason={disabledReason}
        />
        {state.latest && (
          <p className="text-sm">
            最新の診断：<span className="num">{state.latest.requestedOn}</span>（
            {SITE_AUDIT_STATUS_LABEL[state.latest.status]}）・
            <Link
              href={`/app/brands/${props.brandId}/site`}
              className="underline underline-offset-4"
            >
              結果を見る
            </Link>
          </p>
        )}
      </div>
    </section>
  )
}
