/** ホスト名をそろえる（小文字にして、先頭の www. を取る） */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
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
 * （登録が example.com なら、blog.example.com も含む。example.com.evil.test は含まない）
 */
export function isSameSite(host: string, registeredDomain: string | null): boolean {
  if (!registeredDomain) return false
  const h = normalizeHost(host)
  const domain = normalizeHost(registeredDomain)
  return h === domain || h.endsWith(`.${domain}`)
}
