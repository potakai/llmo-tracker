/** サーバーで使う環境変数。足りなければ起動時に落とす */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`)
  return value
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
}
