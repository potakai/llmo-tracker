import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'LLMO Tracker',
  description: 'ChatGPT や Gemini の回答で、自社と競合がどう扱われているかを毎日計測する',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
