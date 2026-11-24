import { Parser } from 'htmlparser2'

/** ページの HTML から取り出したもの（診断の材料） */
export type PageFacts = {
  title: string | null
  metaDescription: string | null
  h1: string[]
  /** 構造化データ（JSON-LD）の種類。一番外側と @graph の中のもの。重複は除いて並べる */
  jsonLdTypes: string[]
  /** JSON として読めなかった JSON-LD の数 */
  brokenJsonLd: number
  /** よくある質問（Q&A の形）があるか、あればどこから分かったか */
  faq: 'json-ld' | 'microdata' | 'html' | null
  /** 本文の文字数（空白をつめたもの。script・style などは数えない） */
  textLength: number
  /** 本文に出てきた名前（渡した名前のうち） */
  mentionedNames: string[]
  /** meta robots（と X-Robots-Tag）で noindex になっているか */
  noindex: boolean
  /** canonical の URL（絶対 URL にしたもの）。なければ null */
  canonical: string | null
  /** ページの中のリンク（絶対 URL にしたもの。# 以降は取る）。ページの一覧を作るのに使う */
  links: string[]
}

/** 数えない・読まない要素 */
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg'])
const QUESTION_TAGS = new Set(['h2', 'h3', 'h4', 'h5', 'dt', 'summary'])
/** 質問らしい見出しがいくつあれば、よくある質問があるとみなすか */
const MIN_QUESTION_HEADINGS = 2
/** 本文として覚えておく文字数の上限（名前を探すため。数えるのは全部） */
const MAX_TEXT_KEPT = 200_000
const FAQ_SCHEMA_TYPES = new Set(['FAQPage', 'QAPage'])

type ExtractOptions = {
  /** ページの URL（相対リンクと canonical を絶対 URL にする） */
  url: string
  /** 本文に出ているかを確かめる名前（会社名・サービス名と別の呼び方） */
  names?: string[]
  /** X-Robots-Tag ヘッダー */
  xRobotsTag?: string | null
}

export function extractPageFacts(html: string, options: ExtractOptions): PageFacts {
  const state = newState()
  const parser = new Parser(
    {
      onopentag: (name, attrs) => onOpen(state, name, attrs, options.url),
      ontext: (text) => onText(state, text),
      onclosetag: (name) => onClose(state, name),
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  )
  parser.write(html)
  parser.end()

  const jsonLd = readJsonLd(state.jsonLdBlocks)
  const bodyText = collapse(state.text.join(''))
  const metaNoindex = state.robotsDirectives.some(hasNoindex)
  return {
    title: nonEmpty(collapse(state.title ?? '')),
    metaDescription: nonEmpty(collapse(state.metaDescription ?? '')),
    h1: state.h1.map(collapse).filter(Boolean),
    jsonLdTypes: jsonLd.types,
    brokenJsonLd: jsonLd.broken,
    faq: jsonLd.types.some((t) => FAQ_SCHEMA_TYPES.has(t))
      ? 'json-ld'
      : state.hasFaqMicrodata
        ? 'microdata'
        : state.questionHeadings >= MIN_QUESTION_HEADINGS
          ? 'html'
          : null,
    textLength: state.textLength,
    mentionedNames: findNames(bodyText, options.names ?? []),
    noindex: metaNoindex || hasNoindex(options.xRobotsTag ?? ''),
    canonical: state.canonical,
    links: [...state.links],
  }
}

type State = ReturnType<typeof newState>

function newState() {
  return {
    title: null as string | null,
    inTitle: false,
    metaDescription: null as string | null,
    robotsDirectives: [] as string[],
    canonical: null as string | null,
    h1: [] as string[],
    h1Depth: 0,
    skipDepth: 0,
    jsonLdBlocks: [] as string[],
    inJsonLd: false,
    question: null as { tag: string; text: string } | null,
    questionHeadings: 0,
    hasFaqMicrodata: false,
    text: [] as string[],
    keptLength: 0,
    textLength: 0,
    links: new Set<string>(),
  }
}

function onOpen(state: State, name: string, attrs: Record<string, string>, url: string) {
  if (name === 'title' && state.title === null) state.inTitle = true
  if (name === 'meta') onMeta(state, attrs)
  if (name === 'link' && relTokens(attrs.rel).includes('canonical') && attrs.href) {
    state.canonical ??= absolute(attrs.href, url)
  }
  if (name === 'a' && attrs.href) {
    const href = absolute(attrs.href, url)
    if (href) state.links.add(href)
  }
  if (name === 'script' && (attrs.type ?? '').trim().toLowerCase() === 'application/ld+json') {
    state.inJsonLd = true
    state.jsonLdBlocks.push('')
  }
  if (/schema\.org\/(FAQPage|Question)\b/i.test(attrs.itemtype ?? '')) state.hasFaqMicrodata = true
  if (SKIPPED_TAGS.has(name)) state.skipDepth += 1
  if (name === 'h1') {
    state.h1Depth += 1
    if (state.h1Depth === 1) state.h1.push('')
  }
  if (QUESTION_TAGS.has(name) && !state.question) state.question = { tag: name, text: '' }
}

function onMeta(state: State, attrs: Record<string, string>) {
  const metaName = (attrs.name ?? '').trim().toLowerCase()
  const content = attrs.content ?? ''
  if (metaName === 'description' && state.metaDescription === null) state.metaDescription = content
  if (metaName === 'robots' || metaName === 'googlebot') state.robotsDirectives.push(content)
}

function onText(state: State, text: string) {
  if (state.inJsonLd) {
    const last = state.jsonLdBlocks.length - 1
    state.jsonLdBlocks[last] = `${state.jsonLdBlocks[last] ?? ''}${text}`
    return
  }
  // title は本文に数えない（</head> がない壊れた HTML でも本文を取りこぼさないよう、head 全体は飛ばさない）
  if (state.inTitle) {
    state.title = `${state.title ?? ''}${text}`
    return
  }
  if (state.skipDepth > 0) return
  if (state.h1Depth > 0) {
    const last = state.h1.length - 1
    state.h1[last] = `${state.h1[last] ?? ''}${text}`
  }
  if (state.question) state.question.text += text
  state.textLength += text.replace(/\s+/g, '').length
  if (state.keptLength < MAX_TEXT_KEPT) {
    state.text.push(text, ' ')
    state.keptLength += text.length
  }
}

function onClose(state: State, name: string) {
  if (name === 'title') state.inTitle = false
  if (name === 'script') state.inJsonLd = false
  if (SKIPPED_TAGS.has(name) && state.skipDepth > 0) state.skipDepth -= 1
  if (name === 'h1' && state.h1Depth > 0) state.h1Depth -= 1
  if (state.question && state.question.tag === name) {
    if (isQuestionLike(state.question.text)) state.questionHeadings += 1
    state.question = null
  }
}

/** 「Q. 〜」「Q：〜」「質問：〜」や、「？」で終わる見出しを、質問らしいとみなす */
function isQuestionLike(text: string): boolean {
  const t = collapse(text)
  return /^(Q|Ｑ|質問)\s*[.．:：、\d]/i.test(t) || /[?？]$/.test(t)
}

function readJsonLd(blocks: string[]): { types: string[]; broken: number } {
  const types = new Set<string>()
  let broken = 0
  for (const block of blocks) {
    const json = parseJson(block)
    if (json === undefined) {
      broken += 1
      continue
    }
    for (const item of topLevelItems(json)) {
      for (const type of typesOf(item)) types.add(type)
    }
  }
  return { types: [...types].sort(), broken }
}

function parseJson(text: string): unknown {
  // HTML のコメントで囲む古い書き方もある
  const cleaned = text.trim().replace(/^<!--/, '').replace(/-->$/, '').trim()
  if (!cleaned) return undefined
  try {
    return JSON.parse(cleaned)
  } catch {
    return undefined
  }
}

/** 一番外側の要素と、@graph の中の要素 */
function topLevelItems(json: unknown): unknown[] {
  const roots = Array.isArray(json) ? json : [json]
  return roots.flatMap((root) => {
    if (!isRecord(root)) return []
    const graph = root['@graph']
    return Array.isArray(graph) ? [root, ...graph] : [root]
  })
}

function typesOf(item: unknown): string[] {
  if (!isRecord(item)) return []
  const raw = item['@type']
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim().replace(/^(https?:\/\/schema\.org\/|schema:)/i, ''))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasNoindex(directives: string): boolean {
  return directives
    .toLowerCase()
    .split(/[,\s]+/)
    .some((d) => d === 'noindex' || d === 'none')
}

function relTokens(rel: string | undefined): string[] {
  return (rel ?? '').toLowerCase().split(/\s+/)
}

function absolute(href: string, base: string): string | null {
  const trimmed = href.trim()
  if (!URL.canParse(trimmed, base)) return null
  const url = new URL(trimmed, base)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  return url.href
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function nonEmpty(text: string): string | null {
  return text === '' ? null : text
}

/** 全角・半角や大文字・小文字の違いは同じとみなして、本文に名前が出ているかを探す */
function findNames(text: string, names: string[]): string[] {
  const haystack = text.normalize('NFKC').toLowerCase()
  return names.filter((name) => {
    const needle = name.normalize('NFKC').toLowerCase().trim()
    return needle !== '' && haystack.includes(needle)
  })
}
