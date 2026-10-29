import { DEMO_ACCOUNT } from '@/lib/demo'
import { AuthForm } from '../auth-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>
}) {
  const { demo } = await searchParams
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">ログイン</h1>
      {demo && (
        <p className="mb-6 rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm">
          デモアカウントの情報を入れてあります。そのままログインすると、30日分のサンプルデータを見られます（開発環境では先に
          <code className="mx-1">pnpm db:seed</code>を実行しておいてください）。
        </p>
      )}
      <AuthForm
        mode="login"
        defaults={demo ? { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password } : undefined}
      />
    </>
  )
}
