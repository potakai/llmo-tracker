import type { ReactNode } from 'react'
import { Wordmark } from '@/components/wordmark'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-10">
        <Wordmark />
      </div>
      {children}
    </div>
  )
}
