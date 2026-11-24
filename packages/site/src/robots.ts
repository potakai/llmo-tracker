/**
 * robots.txt の解釈（RFC 9309 に沿う）。
 * - User-agent の行が続いたあとに、そのグループの Allow / Disallow が続く
 * - クローラーの名前は大文字・小文字を区別せずに比べる。名前の合うグループが複数あれば、ルールをまとめる
 * - 名前の合うグループがなければ `*` のグループ、それもなければ全部読んでよい
 * - いちばん長く一致したルールが勝つ。同じ長さなら Allow が勝つ。空の Disallow は「何も止めない」
 * - `*` は任意の文字列、末尾の `$` は URL の終わり
 * - グループを終わらせるのは Allow / Disallow の行だけ。Sitemap: や知らない行は、グループを分けない（§2.2.4）
 * - 照合は正規表現を使わず、URL の長さに比例する時間で終える（長いパターンで固まらないように）
 */

type Rule = { allow: boolean; pattern: string; matcher: PathMatcher }
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
    if (key === 'sitemap') {
      if (value && !sitemaps.includes(value)) sitemaps.push(value)
      continue
    }
    if (key !== 'allow' && key !== 'disallow') continue
    // ルールの行で、User-agent の並びが終わる（次の User-agent は新しいグループ）
    lastWasAgent = false
    // 空の Disallow（と空の Allow）はルールにしない
    if (!current || !value) continue
    const pattern = normalizePath(value)
    current.rules.push({ allow: key === 'allow', pattern, matcher: compilePattern(pattern) })
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

/**
 * パターンを照合するもの。`*` で区切った断片を、前から順に左端で見つけていく（`*` だけのワイルドカードは
 * これで正しく判定できる）。断片の検索は KMP で、URL の各文字を 1 回ずつしか見ないので、
 * 時間は URL とパターンの長さの和に比例する
 */
type PathMatcher = (path: string) => boolean

function compilePattern(pattern: string): PathMatcher {
  const anchored = pattern.endsWith('$')
  const [first = '', ...rest] = (anchored ? pattern.slice(0, -1) : pattern).split('*')
  // 最後の断片は、$ があれば URL の終わりに合わせる
  const tail = anchored && rest.length > 0 ? (rest.pop() as string) : null
  const middles = rest
    .filter((part) => part !== '')
    .map((part) => ({ part, table: kmpTable(part) }))

  return (path) => {
    if (!path.startsWith(first)) return false
    if (anchored && rest.length === 0 && tail === null) return path === first
    let position = first.length
    for (const { part, table } of middles) {
      const found = kmpSearch(path, part, table, position)
      if (found < 0) return false
      position = found + part.length
    }
    if (tail === null) return true
    return path.length - tail.length >= position && path.endsWith(tail)
  }
}

/** KMP の失敗関数 */
function kmpTable(needle: string): number[] {
  const table = new Array<number>(needle.length).fill(0)
  let k = 0
  for (let i = 1; i < needle.length; i += 1) {
    while (k > 0 && needle[i] !== needle[k]) k = table[k - 1] ?? 0
    if (needle[i] === needle[k]) k += 1
    table[i] = k
  }
  return table
}

/** from 以降で needle が最初に出る位置（なければ -1） */
function kmpSearch(text: string, needle: string, table: number[], from: number): number {
  let k = 0
  for (let i = from; i < text.length; i += 1) {
    while (k > 0 && text[i] !== needle[k]) k = table[k - 1] ?? 0
    if (text[i] === needle[k]) k += 1
    if (k === needle.length) return i - needle.length + 1
  }
  return -1
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
    if (!rule.matcher(target)) continue
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
