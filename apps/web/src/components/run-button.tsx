'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'

/**
 * 「今すぐ計測」。押すと run を作り、終わるまで数秒ごとに画面を更新する。
 * 実行中なら押せない（サーバー側でも 409 で弾く）。
 */
export function RunButton({
  brandId,
  running,
  disabledReason,
}: {
  brandId: string
  running: boolean
  /** 押せない理由（デモなど）。あればボタンを無効にして、理由を下に出す */
  disabledReason?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => router.refresh(), 2500)
    return () => clearInterval(timer)
  }, [running, router])

  async function start() {
    setPending(true)
    setMessage(null)
    const res = await api.brands[':brandId'].runs.$post({ param: { brandId } })
    setPending(false)
    if (res.status === 202) {
      router.refresh()
      return
    }
    const body = (await res.json()) as { error?: { message: string } }
    setMessage(body.error?.message ?? '計測を始められませんでした')
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        className="btn-primary"
        onClick={start}
        disabled={pending || running || disabledReason !== undefined}
        aria-describedby={disabledReason ? 'run-disabled-reason' : undefined}
      >
        {running ? '計測中…' : '今すぐ計測'}
      </button>
      {disabledReason && (
        <p id="run-disabled-reason" className="text-xs text-ink-soft">
          {disabledReason}
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  )
}
