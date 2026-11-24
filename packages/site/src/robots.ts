/**
 * robots.txt の解釈（RFC 9309 に沿う）。
 * - User-agent の行が続いたあとに、そのグループの Allow / Disallow が続く
 * - クローラーの名前は大文字・小文字を区別せずに比べる。名前の合うグループが複数あれば、ルールをまとめる
 * - 名前の合うグループがなければ `*` のグループ、それもなければ全部読んでよい
 * - いちばん長く一致したルールが勝つ。同じ長さなら Allow が勝つ。空の Disallow は「何も止めない」
 * - `*` は任意の文字列、末尾の `$` は URL の終わり
 */

type Rule = { allow: boolean; pattern: string; regex: RegExp }
type Group = { agents: string[]; rules: Rule[] }

export type RobotsTxt = {
  groups: Group[]
  /** Sitemap: の行（書かれた順。重複は除く） */
  sitemaps: string[]
}

/**
 * robots.txt を取りに行った結果。
 * - found：読めた
 * - missing：4xx（ないものとして、全部読んでよい）
 * - unreachable：5xx や通信のエラー（RFC 9309 では、全部止められているものとして扱う）
 */
export type RobotsState =
  | { kind: 'found'; robots: RobotsTxt }
  | { kind: 'missing' }
  | { kind: 'unreachable'; reason: string }

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: Group[] = []
  const sitemaps: string[] = []
  let current: Group | null = null
  // 直前の行が User-agent なら、同じグループに名前を足す
  let lastWasAgent = false

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(productToken(value))
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (key === 'sitemap') {
      if (value && !sitemaps.includes(value)) sitemaps.push(value)
      continue
    }
    if ((key === 'allow' || key === 'disallow') && current) {
      // 空の Disallow（と空の Allow）はルールにしない
      if (!value) continue
      const pattern = normalizePath(value)
      current.rules.push({ allow: key === 'allow', pattern, regex: patternToRegex(pattern) })
    }
  }
  return { groups, sitemaps }
}

/** User-agent の値から名前の部分だけを取り、小文字にする（`GPTBot/1.0` → `gptbot`） */
function productToken(value: string): string {
  return (value.split(/[/\s]/)[0] ?? '').toLowerCase()
}

/** URL の path（と query）を、比べやすい形にそろえる（日本語などはパーセントエンコードする） */
function normalizePath(path: string): string {
  try {
    return encodeURI(decodeURI(path))
  } catch {
    return path
  }
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`)
}

/** そのクローラーに当てはまるルール（名前の合うグループ → `*` のグループ → なし） */
function rulesFor(robots: RobotsTxt, userAgent: string): Rule[] {
  const token = userAgent.toLowerCase()
  const named = robots.groups.filter((g) => g.agents.includes(token))
  const groups = named.length > 0 ? named : robots.groups.filter((g) => g.agents.includes('*'))
  return groups.flatMap((g) => g.rules)
}

/** そのクローラーが、その URL（path と query）を読んでよいか */
export function isAllowedByRobots(robots: RobotsTxt, userAgent: string, url: string): boolean {
  const target = pathOf(url)
  // robots.txt 自体はいつでも読んでよい
  if (target === '/robots.txt') return true
  let best: Rule | null = null
  for (const rule of rulesFor(robots, userAgent)) {
    if (!rule.regex.test(target)) continue
    const longer = !best || rule.pattern.length > best.pattern.length
    const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow
    if (longer || tieAllow) best = rule
  }
  return best ? best.allow : true
}

/** robots.txt を取りに行った結果ごとに、その URL を読んでよいか */
export function isAllowedByRobotsState(
  state: RobotsState,
  userAgent: string,
  url: string,
): boolean {
  if (state.kind === 'missing') return true
  if (state.kind === 'unreachable') return false
  return isAllowedByRobots(state.robots, userAgent, url)
}

/**
 * そのクローラーがサイト全体（トップページ）を止められているか。
 * トップページが読めなければ、AI の回答にサイトが出ることはほぼないので、これで判定する
 */
export function isSiteBlockedFor(state: RobotsState, userAgent: string, origin: string): boolean {
  return !isAllowedByRobotsState(state, userAgent, `${origin}/`)
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return normalizePath(`${parsed.pathname}${parsed.search}`)
  } catch {
    return normalizePath(url)
  }
}
