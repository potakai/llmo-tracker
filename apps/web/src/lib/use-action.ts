'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

type ErrorBody = { error?: { message?: string; issues?: { message: string }[] } }

/**
 * API を呼んで、成功したら画面を更新する。失敗したら、API が返した理由を見せる。
 * 入力チェックのエラーは、最初の項目の理由を出す（どこを直せばいいかが一番わかるため）。
 */
export function useAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function run(request: () => Promise<Response>): Promise<boolean> {
    setError(null)
    let res: Response
    try {
      res = await request()
    } catch {
      setError('通信に失敗しました。接続を確かめて、もう一度試してください')
      return false
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ErrorBody
      setError(body.error?.issues?.[0]?.message ?? body.error?.message ?? '保存できませんでした')
      return false
    }
    startTransition(() => router.refresh())
    return true
  }

  return { run, error, pending, clearError: () => setError(null) }
}
