import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { CheckStatusBadge } from '@/components/check-status-badge'
import {
  PAGE_CHECK_LABEL,
  PAGE_SOURCE_LABEL,
  PAGE_STATUS_LABEL,
  pathOf,
} from '@/components/site-audit-labels'
import { loadBrandForPage } from '@/server/brand-page'
import { getSiteAuditPageDetail } from '@/server/queries/site-audit'

/** ページの詳細で見せる、HTML から取り出したもの（packages/site の PageFacts の一部） */
type Facts = {
  title?: string | null
  metaDescription?: string | null
  h1?: string[]
  jsonLdTypes?: string[]
  faq?: string | null
  textLength?: number
  noindex?: boolean
  canonical?: string | null
}

const pageIdSchema = z.uuid()

/** サイト診断の、1 ページの詳細（項目ごとの結果と、HTML から取り出したもの） */
export default async function SiteAuditPageDetail({
  params,
}: {
  params: Promise<{ brandId: string; pageId: string }>
}) {
  const { brandId, pageId } = await params
  const { organizationId, brand } = await loadBrandForPage(brandId)
  const parsed = pageIdSchema.safeParse(pageId)
  if (!parsed.success) notFound()
  const page = await getSiteAuditPageDetail(organizationId, brand.id, parsed.data)
  if (!page) notFound()
  const facts = (page.facts ?? null) as Facts | null

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/app/brands/${brand.id}/site`}
          className="text-sm underline underline-offset-4"
        >
          ← サイト診断に戻る
        </Link>
        <h2 className="mt-2 text-xl font-bold break-all">{pathOf(page.url)}</h2>
        <p className="mt-1 text-sm text-ink-soft break-all">
          {page.url}・<span className="num">{page.requestedOn}</span> の診断・
          {PAGE_SOURCE_LABEL[page.source]}
        </p>
        {page.finalUrl && page.finalUrl !== page.url && (
          <p className="mt-1 text-sm text-ink-soft break-all">リダイレクト先：{page.finalUrl}</p>
        )}
      </div>

      {page.status !== 'fetched' && (
        <p className="rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm">
          {PAGE_STATUS_LABEL[page.status]}
          {page.error && `：${page.error}`}
        </p>
      )}

      {page.checks.length > 0 && (
        <section aria-labelledby="page-checks-heading">
          <h3 id="page-checks-heading" className="text-lg font-bold">
            診断の結果
          </h3>
          <ul className="panel mt-3 divide-y divide-rule">
            {page.checks.map((check) => (
              <li key={check.key} className="flex gap-3 px-4 py-3">
                <CheckStatusBadge status={check.status} />
                <div>
                  <p className="font-bold">{PAGE_CHECK_LABEL[check.key] ?? check.key}</p>
                  <p className="mt-1 text-sm leading-relaxed">{check.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {facts && <FactsTable facts={facts} />}
    </div>
  )
}

function FactsTable({ facts }: { facts: Facts }) {
  const none = <span className="text-ink-soft">なし</span>
  const rows: [string, React.ReactNode][] = [
    ['タイトル', facts.title ?? none],
    ['ページの説明', facts.metaDescription ?? none],
    ['h1', facts.h1 && facts.h1.length > 0 ? facts.h1.join(' / ') : none],
    [
      '構造化データ',
      facts.jsonLdTypes && facts.jsonLdTypes.length > 0 ? facts.jsonLdTypes.join('、') : none,
    ],
    ['よくある質問', facts.faq ? 'あり' : none],
    ['本文の文字数', `${facts.textLength ?? 0} 文字`],
    ['noindex', facts.noindex ? 'あり（検索エンジンに載らない）' : none],
    ['canonical', facts.canonical ?? none],
  ]
  return (
    <section aria-labelledby="page-facts-heading">
      <h3 id="page-facts-heading" className="text-lg font-bold">
        ページから読み取ったもの
      </h3>
      <dl className="panel mt-3 divide-y divide-rule text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-ink-soft sm:w-32">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
