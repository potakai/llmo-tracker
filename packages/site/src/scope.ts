/** ホスト名をそろえる（小文字にして、先頭の www. と末尾の . を取る） */
export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '')
}

/** URL のホスト名（そろえたもの）。URL として読めなければ null */
export function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname)
  } catch {
    return null
  }
}

/**
 * ホストが、登録したドメインのサイトか。サブドメインも同じサイトとみなす
 * （登録が example.com なら、blog.example.com も含む。example.com.evil.test や badexample.com は含まない）
 */
export function isSameSite(host: string, registeredDomain: string | null): boolean {
  if (!registeredDomain) return false
  const h = normalizeHost(host)
  const domain = normalizeHost(registeredDomain)
  if (!domain) return false
  return h === domain || h.endsWith(`.${domain}`)
}

/** 読んでよいポート（ブランドのサイトは、ふつうの http / https のポートだけ。'' は省略したもの） */
export const DEFAULT_PORTS: ReadonlySet<string> = new Set(['', '80', '443'])

export type AuditableUrlOptions = {
  /** 相対 URL の基準 */
  base?: string
  /** 読んでよいポート（テストで手元のサーバーを読むときだけ変える） */
  ports?: ReadonlySet<string>
}

/**
 * 診断で読んでよい URL か。読んでよければ、そろえた URL（# 以降を取る）を返す。
 * - http / https だけ。ユーザー名・パスワード付きの URL は読まない
 * - 登録したドメインとそのサブドメインだけ
 * - ふつうのポート（80 / 443）だけ
 */
export function toAuditableUrl(
  raw: string,
  registeredDomain: string,
  options: AuditableUrlOptions = {},
): URL | null {
  if (!URL.canParse(raw, options.base)) return null
  const url = new URL(raw, options.base)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (!(options.ports ?? DEFAULT_PORTS).has(url.port)) return null
  if (!isSameSite(url.hostname, registeredDomain)) return null
  return new URL(`${url.origin}${url.pathname}${url.search}`)
}

/** 登録したドメインのトップページ（https） */
export function siteOrigin(registeredDomain: string): string {
  return `https://${registeredDomain.toLowerCase().replace(/\.$/, '')}`
}
