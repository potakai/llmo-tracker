import type { ReactNode } from 'react'
import { SignOutButton } from '@/components/sign-out-button'
import { Wordmark } from '@/components/wordmark'
import { requireViewerWithOrg } from '@/server/viewer'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewerWithOrg()
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Wordmark href="/app" />
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-ink-soft sm:inline">{viewer.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
