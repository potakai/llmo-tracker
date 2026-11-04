import type { ReactNode } from 'react'
import { BrandTabs } from '@/components/brand-tabs'
import { loadBrandForPage } from '@/server/brand-page'

export default async function BrandLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ brandId: string }>
}) {
  const { brand, isDemo } = await loadBrandForPage((await params).brandId)
  return (
    <div className="flex flex-col gap-6">
      {isDemo && (
        <p className="rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm">
          デモアカウントで見ています。中身は架空のサンプルデータで、計測や設定の変更はできません。
          自分のブランドで試すには、ログアウトして新しくアカウントを作ってください。
        </p>
      )}
      <div>
        <p className="text-sm text-ink-soft">計測しているブランド</p>
        <h1 className="text-2xl font-bold">{brand.name}</h1>
      </div>
      <BrandTabs brandId={brand.id} />
      {children}
    </div>
  )
}
