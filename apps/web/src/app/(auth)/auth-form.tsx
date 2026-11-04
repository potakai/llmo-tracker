'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { authClient } from '@/lib/auth-client'

/** 失敗の理由を、利用者が次に何をすればいいかわかる言葉にする */
function describeError(mode: 'login' | 'signup', error: { status?: number; message?: string }) {
  if (error.status !== undefined && error.status >= 500) {
    return 'サーバーでエラーが起きました。少し待ってからもう一度試してください'
  }
  if (error.status === 403) {
    return 'ログインを受け付けられませんでした。開いている URL が、サーバーの設定（BETTER_AUTH_URL）と合っているか確かめてください'
  }
  if (mode === 'login') return 'メールアドレスかパスワードが違います'
  if (error.status === 422) return 'このメールアドレスはすでに登録されています'
  return error.message ?? '登録できませんでした。入力内容を確かめてください'
}

type Props = {
  mode: 'login' | 'signup'
  defaults?: { email: string; password: string }
}

export function AuthForm({ mode, defaults }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    setPending(true)
    setError(null)

    const result =
      mode === 'login'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get('name')) })

    setPending(false)
    if (result.error) {
      setError(describeError(mode, result.error))
      return
    }
    router.push(mode === 'login' ? '/app' : '/onboarding')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {mode === 'signup' && (
        <label className="flex flex-col gap-1">
          <span className="text-sm">お名前</span>
          <input name="name" required className="field" autoComplete="name" />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-sm">メールアドレス</span>
        <input
          name="email"
          type="email"
          required
          className="field"
          autoComplete="email"
          defaultValue={defaults?.email}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">パスワード{mode === 'signup' && '（8文字以上）'}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="field"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          defaultValue={defaults?.password}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary mt-2" disabled={pending}>
        {mode === 'login' ? 'ログイン' : 'アカウントを作成'}
      </button>

      <p className="text-sm text-ink-soft">
        {mode === 'login' ? (
          <>
            はじめての方は{' '}
            <Link href="/signup" className="text-ink underline">
              アカウントを作成
            </Link>
          </>
        ) : (
          <>
            アカウントをお持ちの方は{' '}
            <Link href="/login" className="text-ink underline">
              ログイン
            </Link>
          </>
        )}
      </p>
    </form>
  )
}
