import { AuthForm } from '../auth-form'

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">アカウントを作成</h1>
      <AuthForm mode="signup" />
    </>
  )
}
