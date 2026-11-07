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
  const { brand, isDemo, llmMode } = await loadBrandForPage((await params).brandId)
  return (
    <div className="flex flex-col gap-6">
      {isDemo && (
        <p className="rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm">
          デモアカウントで見ています。中身は架空のサンプルデータで、計測や設定の変更はできません。
          自分のブランドで試すには、ログアウトして新しくアカウントを作ってください。
        </p>
      )}
      {!isDemo && llmMode === 'fake' && (
        <p className="rounded-[var(--radius-box)] border border-rule bg-surface px-4 py-3 text-sm">
          この組織の計測は<strong>サンプルの AI</strong>
          で行っています。ChatGPT や Gemini
          には実際には聞いておらず、回答と数字は動作確認用の作り物です（公開版で API
          の費用がかからないようにしています）。
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
