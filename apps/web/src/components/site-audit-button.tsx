'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api-client'
import { AutoRefresh } from './auto-refresh'

/**
 * 「今すぐ診断」。押すとサイト診断を始め、終わるまで画面を更新する。
 * 1 日 1 回まで・実行中・デモ・ドメインなしでは押せない（サーバー側でも断る）
 */
export function SiteAuditButton({
  brandId,
  running,
  disabledReason,
}: {
  brandId: string
  running: boolean
  /** 押せない理由。あればボタンを無効にして、理由を下に出す */
  disabledReason?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function start() {
    setPending(true)
    setMessage(null)
    try {
      const res = await api.brands[':brandId']['site-audits'].$post({ param: { brandId } })
      if (res.status === 202) {
        router.refresh()
        return
      }
      const body = (await res.json()) as { error?: { message: string } }
      setMessage(body.error?.message ?? '診断を始められませんでした')
    } catch {
      setMessage('通信に失敗しました。接続を確かめて、もう一度試してください')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <AutoRefresh active={running} />
      <button
        type="button"
        className="btn-primary"
        onClick={start}
        disabled={pending || running || disabledReason !== undefined}
        aria-describedby={disabledReason ? 'site-audit-disabled-reason' : undefined}
      >
        {running ? '診断中…' : '今すぐ診断'}
      </button>
      {disabledReason && (
        <p id="site-audit-disabled-reason" className="text-xs text-ink-soft">
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
