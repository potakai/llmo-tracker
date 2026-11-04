import Link from 'next/link'
import { Wordmark } from '@/components/wordmark'

/** 見つからないページ。古い URL を開いたときなどに、どこへ戻ればいいかを示す */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <Wordmark />
      <div>
        <h1 className="text-2xl font-bold">ページが見つかりません</h1>
        <p className="mt-2 text-ink-soft">
          URL
          が変わったか、削除された可能性があります。ログインしている場合は、計測画面から開き直してください。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/app" className="btn-primary">
          計測画面へ
        </Link>
        <Link href="/" className="btn-quiet">
          トップへ
        </Link>
      </div>
    </div>
  )
}
