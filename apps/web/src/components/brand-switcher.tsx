'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/api-client'

type BrandOption = { id: string; name: string }

type BrandSwitcherProps = {
  brands: BrandOption[]
  /** Cookie に覚えているブランド（/app で開くブランド） */
  rememberedBrandId: string | null
  /** デモの組織では「ブランドを追加」を出さない（追加は 403 になる） */
  canAddBrand: boolean
}

/**
 * ヘッダーのブランド切り替え。今のブランド名を押すと、組織のブランドの一覧と「ブランドを追加」が開く。
 * ブランドの画面を開いたら、そのブランドを「最後に見たブランド」として覚える（/app でそこへ移動する）
 */
export function BrandSwitcher({ brands, rememberedBrandId, canAddBrand }: BrandSwitcherProps) {
  const params = useParams<{ brandId?: string }>()
  const brandId = params.brandId
  const current = brands.find((b) => b.id === brandId)
  const menu = useRef<HTMLDetailsElement>(null)
  useRememberBrand(current?.id, rememberedBrandId)
  useCloseOnOutsideClick(menu)

  const close = () => {
    if (menu.current) menu.current.open = false
  }

  return (
    <details ref={menu} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-box)] border border-rule px-3 py-1.5 text-sm hover:bg-paper">
        <span className="sr-only">ブランドを切り替える。今のブランド：</span>
        <span className="max-w-48 truncate font-bold">{current?.name ?? 'ブランドを選ぶ'}</span>
        <span aria-hidden="true" className="text-ink-soft">
          ▾
        </span>
      </summary>
      <div className="absolute left-0 z-10 mt-1 w-64 rounded-[var(--radius-box)] border border-rule bg-surface py-1 shadow-lg">
        <ul aria-label="ブランドの一覧">
          {brands.map((b) => (
            <li key={b.id}>
              <Link
                href={`/app/brands/${b.id}`}
                onClick={close}
                aria-current={b.id === current?.id ? 'page' : undefined}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-paper aria-[current=page]:font-bold"
              >
                <span className="truncate">{b.name}</span>
                {b.id === current?.id && <span aria-hidden="true">✓</span>}
              </Link>
            </li>
          ))}
        </ul>
        {canAddBrand && (
          <Link
            href="/app/brands/new"
            onClick={close}
            className="block border-t border-rule px-3 py-2 text-sm text-ink-soft hover:bg-paper hover:text-ink"
          >
            ＋ ブランドを追加
          </Link>
        )}
      </div>
    </details>
  )
}

/**
 * 開いているブランドが覚えているものと違えば、サーバーに覚えてもらう（Cookie）。
 * 覚えられなくても画面はそのまま使える（/app で開くブランドが変わらないだけ）ので、失敗しても止めない
 */
function useRememberBrand(brandId: string | undefined, rememberedBrandId: string | null) {
  const remembered = useRef(rememberedBrandId)
  useEffect(() => {
    if (!brandId || brandId === remembered.current) return
    remembered.current = brandId
    api['current-brand'].$put({ json: { brandId } }).catch((error: unknown) => {
      console.warn('最後に見たブランドを覚えられませんでした', error)
      remembered.current = null
    })
  }, [brandId])
}

/** メニューの外を押すか Esc で閉じる */
function useCloseOnOutsideClick(menu: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = menu.current
      if (el?.open && !el.contains(event.target as Node)) el.open = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const el = menu.current
      if (event.key === 'Escape' && el?.open) {
        el.open = false
        el.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])
}
