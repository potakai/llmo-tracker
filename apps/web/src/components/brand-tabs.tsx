'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** ブランドの中の画面切り替え。今いる画面に aria-current を付ける */
export function BrandTabs({ brandId }: { brandId: string }) {
  const pathname = usePathname()
  const base = `/app/brands/${brandId}`
  const isHints = pathname.startsWith(`${base}/hints`)
  const isGoogle = pathname.startsWith(`${base}/google`)
  const isSite = pathname.startsWith(`${base}/site`)
  const isSettings = pathname.startsWith(`${base}/settings`)
  const tabs = [
    { href: base, label: '計測結果', active: !isHints && !isGoogle && !isSite && !isSettings },
    { href: `${base}/hints`, label: '改善のヒント', active: isHints },
    { href: `${base}/google`, label: 'Google との比較', active: isGoogle },
    { href: `${base}/site`, label: 'サイト診断', active: isSite },
    { href: `${base}/settings`, label: '設定', active: isSettings },
  ]
  return (
    <nav aria-label="ブランドの画面" className="flex gap-1 border-b border-rule">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            tab.active
              ? 'border-ink font-bold text-ink'
              : 'border-transparent text-ink-soft hover:text-ink'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
