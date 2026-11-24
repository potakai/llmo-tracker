import { Parser } from 'htmlparser2'

export type Sitemap =
  /** ページの一覧（urlset） */
  | { kind: 'urlset'; urls: string[] }
  /** ほかの sitemap の一覧（sitemapindex） */
  | { kind: 'index'; sitemaps: string[] }
  /** sitemap の形ではない */
  | { kind: 'invalid' }

/** sitemap.xml の <loc> を、書かれた順に取り出す（重複は除く） */
export function parseSitemap(xml: string): Sitemap {
  let root: string | null = null
  let inLoc = false
  let current = ''
  const locs = new Set<string>()
  const parser = new Parser(
    {
      onopentag(name) {
        const local = localName(name)
        root ??= local
        if (local === 'loc') {
          inLoc = true
          current = ''
        }
      },
      ontext(text) {
        if (inLoc) current += text
      },
      onclosetag(name) {
        if (localName(name) !== 'loc') return
        inLoc = false
        const loc = current.trim()
        if (loc) locs.add(loc)
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.write(xml)
  parser.end()

  if (root === 'urlset') return { kind: 'urlset', urls: [...locs] }
  if (root === 'sitemapindex') return { kind: 'index', sitemaps: [...locs] }
  return { kind: 'invalid' }
}

/** 名前空間の接頭辞を取って小文字にする（`ns:urlset` → `urlset`） */
function localName(name: string): string {
  return (name.split(':').pop() ?? name).toLowerCase()
}
