/**
 * 接続文字列から、postgres.js が扱えない指定を取り除く。
 *
 * Neon がコピー用に出す接続文字列には `channel_binding=require` が付いている。これは libpq（psql など）向けの指定で、
 * postgres.js は知らない指定をそのまま Postgres の設定として送るため、「unrecognized configuration parameter」で
 * 接続に失敗する。Vercel や手元の .env に、Neon の文字列をそのまま貼っても動くようにここで取り除く。
 */
const LIBPQ_ONLY_PARAMS = ['channel_binding'] as const

export function normalizeDatabaseUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  let changed = false
  for (const name of LIBPQ_ONLY_PARAMS) {
    if (parsed.searchParams.has(name)) {
      parsed.searchParams.delete(name)
      changed = true
    }
  }
  return changed ? parsed.toString() : url
}
