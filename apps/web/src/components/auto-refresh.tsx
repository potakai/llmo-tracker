'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const REFRESH_INTERVAL_MS = 2500

/** active の間、画面を定期的に更新する（ジョブの終わりを待つ画面用） */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active, router])
  return null
}
