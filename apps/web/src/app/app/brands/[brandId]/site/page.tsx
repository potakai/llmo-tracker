import Link from 'next/link'
import { AutoRefresh } from '@/components/auto-refresh'
import { CheckStatusBadge } from '@/components/check-status-badge'
import { formatDate } from '@/components/labels'
import {
  PAGE_CHECK_LABEL,
  PAGE_SOURCE_LABEL,
  PAGE_STATUS_LABEL,
  pathOf,
  SITE_AUDIT_STATUS_LABEL,
  SITE_CHECK_LABEL,
} from '@/components/site-audit-labels'
import { getSitePolicy } from '@/lib/site'
import type { ComparableCheck } from '@/lib/site-audit-diff'
import { loadBrandForPage } from '@/server/brand-page'
import {
  getSiteAuditOverview,
  type SiteAuditOverview,
  type SiteAuditPageRow,
} from '@/server/queries/site-audit'

/**
 * サイト診断：ブランドに登録したドメインのサイトを読み、AI に拾われやすい作りかを診断した結果。
 * サイト全体の項目を要対応のものから並べ、ページごとの一覧と、前回の診断からの変化を出す
 */
export default async function SiteAuditPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { organizationId, brand, isDemo } = await loadBrandForPage((await params).brandId)
  const overview = await getSiteAuditOverview(organizationId, brand.id)
  const siteMode = getSitePolicy().modeFor(organizationId)
  const settingsHref = `/app/brands/${brand.id}/settings`

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh active={overview.isRunning} />
      <section className="max-w-3xl">
        <h2 className="text-xl font-bold">サイト診断</h2>
        <p className="mt-2 leading-relaxed">
          御社のサイト（{brand.domain ?? 'ドメイン未設定'}）を読み、AI
          に拾われやすい作りになっているかを診断しました。毎週月曜に自動で診断します。
          {!isDemo && (
            <>
              すぐに診断し直すときは、
              <Link href={settingsHref} className="underline underline-offset-4">
                設定
              </Link>
              の「今すぐ診断」を押してください（1 日 1 回まで）。
            </>
          )}
        </p>
      </section>

      {!isDemo && siteMode === 'fake' && (
        <p className="rounded-[var(--radius-box)] border border-rule bg-surface px-4 py-3 text-sm">
          この組織のサイト診断は<strong>サンプル</strong>
          です。実際のサイトは読んでおらず、結果は動作確認用の作り物の HTML から作っています。
        </p>
      )}

      {!brand.domain && (
        <p className="rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm leading-relaxed">
          サイトのドメインが設定されていないため、診断できません。
          <Link href={settingsHref} className="font-bold underline underline-offset-4">
            設定
          </Link>
          でドメイン（例：example.co.jp）を登録してください。
        </p>
      )}

      <LatestStatus overview={overview} />

      {overview.current && (
        <>
          <SiteChecks overview={overview} />
          <Changes overview={overview} />
          <PageList brandId={brand.id} pages={overview.pages} />
        </>
      )}
    </div>
  )
}

function LatestStatus({ overview }: { overview: SiteAuditOverview }) {
  const { latest, current } = overview
  if (!latest) {
    return (
      <p className="max-w-3xl leading-relaxed">
        まだ診断していません。毎週月曜の自動の診断か、設定の「今すぐ診断」で診断できます。
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      {current && (
        <p>
          <span className="num">{current.requestedOn}</span> の診断結果（{current.domain}）
          {current.finishedAt && (
            <span className="text-ink-soft">・{formatDate(current.finishedAt)} 完了</span>
          )}
        </p>
      )}
      {latest.id !== current?.id && (
        <p className={latest.status === 'failed' ? 'text-danger' : 'text-ink-soft'}>
          最新の診断（{latest.requestedOn}）：{SITE_AUDIT_STATUS_LABEL[latest.status]}
          {latest.error && `。${latest.error}`}
        </p>
      )}
    </div>
  )
}

function SiteChecks({ overview }: { overview: SiteAuditOverview }) {
  return (
    <section aria-labelledby="site-checks-heading" className="max-w-3xl">
      <h3 id="site-checks-heading" className="text-lg font-bold">
        サイト全体
      </h3>
      <ul className="panel mt-3 divide-y divide-rule">
        {overview.siteChecks.map((check) => (
          <li key={check.key} className="flex gap-3 px-4 py-3">
            <CheckStatusBadge status={check.status} />
            <div>
              <p className="font-bold">{SITE_CHECK_LABEL[check.key] ?? check.key}</p>
              <p className="mt-1 text-sm leading-relaxed">{check.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Changes({ overview }: { overview: SiteAuditOverview }) {
  if (!overview.previous || !overview.changes) {
    return (
      <p className="max-w-3xl text-sm text-ink-soft">
        前回の診断がないので、変化はまだ出せません（次の診断から出ます）。
      </p>
    )
  }
  const { fixed, appeared } = overview.changes
  return (
    <section aria-labelledby="changes-heading" className="max-w-3xl">
      <h3 id="changes-heading" className="text-lg font-bold">
        前回（<span className="num">{overview.previous.requestedOn}</span>）からの変化
      </h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <ChangeList title={`直った（${fixed.length}）`} items={fixed} empty="ありません" />
        <ChangeList
          title={`新しく出た（${appeared.length}）`}
          items={appeared}
          empty="ありません"
        />
      </div>
    </section>
  )
}

function ChangeList(props: { title: string; items: ComparableCheck[]; empty: string }) {
  return (
    <div className="panel px-4 py-3">
      <h4 className="font-bold">{props.title}</h4>
      {props.items.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">{props.empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {props.items.map((item) => (
            <li key={`${item.pageUrl ?? ''}-${item.key}`}>
              {item.pageUrl === null ? (
                <span className="font-bold">サイト全体</span>
              ) : (
                <span className="font-bold break-all">{pathOf(item.pageUrl)}</span>
              )}
              ：
              {item.pageUrl === null
                ? (SITE_CHECK_LABEL[item.key] ?? item.key)
                : (PAGE_CHECK_LABEL[item.key] ?? item.key)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PageList({ brandId, pages }: { brandId: string; pages: SiteAuditPageRow[] }) {
  return (
    <section aria-labelledby="pages-heading">
      <h3 id="pages-heading" className="text-lg font-bold">
        ページごと（{pages.length} ページ）
      </h3>
      <p className="mt-1 text-sm text-ink-soft">
        トップページ、AI の回答で引用されたページ、サイトマップの順に、最大 50 ページを読みました。
      </p>
      <div className="mt-3 overflow-x-auto rounded-[var(--radius-box)] border border-rule bg-surface">
        <table className="w-full text-left text-sm" aria-label="ページごとの診断">
          <thead className="border-b border-rule text-ink-soft">
            <tr>
              <th className="px-4 py-2 font-medium">ページ</th>
              <th className="px-4 py-2 text-right font-medium whitespace-nowrap">要対応</th>
              <th className="px-4 py-2 text-right font-medium whitespace-nowrap">注意</th>
              <th className="px-4 py-2 font-medium">読んだ理由</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {pages.map((page) => (
              <tr key={page.id}>
                <td className="px-4 py-2">
                  <Link
                    href={`/app/brands/${brandId}/site/pages/${page.id}`}
                    className="break-all underline underline-offset-4"
                  >
                    {pathOf(page.url)}
                  </Link>
                  {page.status !== 'fetched' && (
                    <span className="block text-xs text-ink-soft">
                      {PAGE_STATUS_LABEL[page.status]}
                      {page.error && `：${page.error}`}
                    </span>
                  )}
                </td>
                <td
                  className={`num px-4 py-2 text-right ${page.critical > 0 ? 'font-bold text-danger' : ''}`}
                >
                  {page.critical}
                </td>
                <td className="num px-4 py-2 text-right">{page.warning}</td>
                <td className="px-4 py-2 text-ink-soft">{PAGE_SOURCE_LABEL[page.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
