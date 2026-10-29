'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function SignOutButton() {
  const router = useRouter()
  return (
    <button
      type="button"
      className="text-sm text-ink-soft hover:text-ink hover:underline"
      onClick={async () => {
        await authClient.signOut()
        router.push('/login')
        router.refresh()
      }}
    >
      ログアウト
    </button>
  )
}
