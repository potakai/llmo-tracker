/**
 * robots.txt の解釈（RFC 9309 に沿う）。
 * - User-agent の行が続いたあとに、そのグループの Allow / Disallow が続く
 * - クローラーの名前は大文字・小文字を区別せずに比べる。名前の合うグループが複数あれば、ルールをまとめる
 * - 名前の合うグループがなければ `*` のグループ、それもなければ全部読んでよい
 * - いちばん長く一致したルールが勝つ。同じ長さなら Allow が勝つ。空の Disallow は「何も止めない」
 * - `*` は任意の文字列、末尾の `$` は URL の終わり
 * - グループを終わらせるのは Allow / Disallow の行だけ。Sitemap: や知らない行は、グループを分けない（§2.2.4）
 * - 照合は正規表現を使わず、URL の長さに比例する時間で終える（長いパターンで固まらないように）
 * - パーセントエンコード（§2.2.2〜2.2.3）：ルールの生の `*` と末尾の `$` を先に構文として取り分け、
 *   残りの文字の部分と URL を、オクテット単位で同じ形に正規化してから比べる（normalizeOctets）
 */

/** length は正規化したあとの長さ（`*` と `$` は 1 文字として数える）。優先順位に使う */
type Rule = { allow: boolean; length: number; matcher: PathMatcher }
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
  const sitemaps = new Set<string>()
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
      if (value) sitemaps.add(value)
      continue
    }
    if (key !== 'allow' && key !== 'disallow') continue
    // ルールの行で、User-agent の並びが終わる（次の User-agent は新しいグループ）
    lastWasAgent = false
    // 空の Disallow（と空の Allow）はルールにしない
    if (!current || !value) continue
    current.rules.push(compileRule(key === 'allow', value))
  }
  return { groups, sitemaps: [...sitemaps] }
}

/** User-agent の値から名前の部分だけを取り、小文字にする（`GPTBot/1.0` → `gptbot`） */
function productToken(value: string): string {
  return (value.split(/[/\s]/)[0] ?? '').toLowerCase()
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/
/** エンコードしてあってもしてなくても同じとみなす文字（§2.2.3 の表：%2A と *、%24 と $） */
const SAME_WHEN_ENCODED = new Set(['*', '$'])
const HEX = /^[0-9A-Fa-f]{2}$/
const utf8 = new TextEncoder()

const pct = (byte: number) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`

/**
 * URL の path・ルールの文字の部分を、オクテット単位で同じ形にそろえる。
 * - %XX は、非予約文字と `*`・`$` ならデコードし、それ以外（予約文字・非 ASCII など）は大文字の %XX にする
 *   （%2F と %2f は同じ。%2F と / は別）
 * - そのままの非 ASCII 文字は UTF-8 のバイトごとに %XX にする。空白・制御文字・単独の % も %XX にする
 */
export function normalizeOctets(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; ) {
    const hex = input[i] === '%' ? input.slice(i + 1, i + 3) : ''
    if (HEX.test(hex)) {
      const byte = Number.parseInt(hex, 16)
      const char = String.fromCharCode(byte)
      out +=
        byte < 0x80 && (UNRESERVED.test(char) || SAME_WHEN_ENCODED.has(char)) ? char : pct(byte)
      i += 3
      continue
    }
    const codePoint = input.codePointAt(i) ?? 0
    const char = String.fromCodePoint(codePoint)
    i += char.length
    if (codePoint >= 0x80) {
      for (const byte of utf8.encode(char)) out += pct(byte)
    } else if (codePoint <= 0x20 || codePoint === 0x7f || char === '%') {
      out += pct(codePoint)
    } else {
      out += char
    }
  }
  return out
}

/**
 * ルールを作る。生の `*`（ワイルドカード）と末尾の `$`（URL の終わり）を先に取り分け、
 * 残りの文字の部分だけを正規化する（%2A や %24 は、その文字そのものとして比べる）
 */
function compileRule(allow: boolean, value: string): Rule {
  const anchored = value.endsWith('$')
  const parts = (anchored ? value.slice(0, -1) : value).split('*').map(normalizeOctets)
  const literal = parts.reduce((sum, part) => sum + part.length, 0)
  const length = literal + (parts.length - 1) + (anchored ? 1 : 0)
  return { allow, length, matcher: compilePattern(parts, anchored) }
}

/**
 * パターンを照合するもの。`*` で区切った断片を、前から順に左端で見つけていく（`*` だけのワイルドカードは
 * これで正しく判定できる）。断片の検索は KMP で、URL の各文字を 1 回ずつしか見ないので、
 * 時間は URL とパターンの長さの和に比例する
 */
type PathMatcher = (path: string) => boolean

function compilePattern(parts: string[], anchored: boolean): PathMatcher {
  const [first = '', ...rest] = parts
  // 最後の断片は、$ があれば URL の終わりに合わせる
  const tail = anchored && rest.length > 0 ? (rest.at(-1) as string) : null
  const middles = (tail === null ? rest : rest.slice(0, -1))
    .filter((part) => part !== '')
    .map((part) => ({ part, table: kmpTable(part) }))

  return (path) => {
    if (!path.startsWith(first)) return false
    if (anchored && rest.length === 0) return path === first
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

/** クローラーの名前ごとに、当てはまるルールを覚えておく（同じ robots.txt で何度も判定するため） */
const rulesCache = new WeakMap<RobotsTxt, Map<string, Rule[]>>()

/** そのクローラーに当てはまるルール（名前の合うグループ → `*` のグループ → なし） */
function rulesFor(robots: RobotsTxt, userAgent: string): Rule[] {
  const token = userAgent.toLowerCase()
  let byToken = rulesCache.get(robots)
  if (!byToken) {
    byToken = new Map()
    rulesCache.set(robots, byToken)
  }
  const cached = byToken.get(token)
  if (cached) return cached
  const named = robots.groups.filter((g) => g.agents.includes(token))
  const groups = named.length > 0 ? named : robots.groups.filter((g) => g.agents.includes('*'))
  const rules = groups.flatMap((g) => g.rules)
  byToken.set(token, rules)
  return rules
}

/** そのクローラーが、その URL（path と query）を読んでよいか */
export function isAllowedByRobots(robots: RobotsTxt, userAgent: string, url: string): boolean {
  const target = pathOf(url)
  // robots.txt 自体はいつでも読んでよい
  if (target === '/robots.txt') return true
  let best: Rule | null = null
  for (const rule of rulesFor(robots, userAgent)) {
    if (!rule.matcher(target)) continue
    const longer = !best || rule.length > best.length
    const tieAllow = best && rule.length === best.length && rule.allow
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
  if (!URL.canParse(url)) return normalizeOctets(url)
  const parsed = new URL(url)
  return normalizeOctets(`${parsed.pathname}${parsed.search}`)
}
