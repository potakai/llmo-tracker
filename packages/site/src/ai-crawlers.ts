/**
 * AI のクローラーの一覧。robots.txt でこれらを止めていないかを診断する。名前を足すときはここだけを直す。
 *
 * purpose：
 * - search：AI の検索（回答に出すページを探す）。止めると、AI の回答に出にくくなる → 要対応
 * - user：利用者が AI にページを読ませたときに使う。止めると、AI がページを読めない → 要対応
 * - training：学習用。止めても AI の検索にはふつう影響しないが、方針として止めているかを確かめる → 注意
 *
 * 出どころ（2026-11 時点で確かめたもの）：
 * - OpenAI：https://platform.openai.com/docs/bots（GPTBot / OAI-SearchBot / ChatGPT-User）
 * - Google：https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers（Google-Extended）
 * - Anthropic：https://support.anthropic.com/en/articles/8896518（ClaudeBot / Claude-SearchBot / Claude-User）
 * - Perplexity：https://docs.perplexity.ai/guides/bots（PerplexityBot / Perplexity-User）
 * - Apple：https://support.apple.com/en-us/119829（Applebot-Extended）
 * - Common Crawl：https://commoncrawl.org/ccbot（CCBot。多くの AI の学習データの元になる）
 */
export const AI_CRAWLERS = [
  { userAgent: 'OAI-SearchBot', vendor: 'OpenAI', purpose: 'search' },
  { userAgent: 'ChatGPT-User', vendor: 'OpenAI', purpose: 'user' },
  { userAgent: 'GPTBot', vendor: 'OpenAI', purpose: 'training' },
  { userAgent: 'Google-Extended', vendor: 'Google', purpose: 'training' },
  { userAgent: 'Claude-SearchBot', vendor: 'Anthropic', purpose: 'search' },
  { userAgent: 'Claude-User', vendor: 'Anthropic', purpose: 'user' },
  { userAgent: 'ClaudeBot', vendor: 'Anthropic', purpose: 'training' },
  { userAgent: 'PerplexityBot', vendor: 'Perplexity', purpose: 'search' },
  { userAgent: 'Perplexity-User', vendor: 'Perplexity', purpose: 'user' },
  { userAgent: 'Applebot-Extended', vendor: 'Apple', purpose: 'training' },
  { userAgent: 'CCBot', vendor: 'Common Crawl', purpose: 'training' },
] as const satisfies readonly AiCrawler[]

export type AiCrawlerPurpose = 'search' | 'user' | 'training'

export type AiCrawler = {
  /** robots.txt の User-agent に書く名前（プロダクトトークン） */
  userAgent: string
  vendor: string
  purpose: AiCrawlerPurpose
}

/**
 * このツールのクローラーの名前。robots.txt の User-agent ではこの名前で止められる。
 * User-Agent ヘッダーには、何のツールか分かるように説明も付ける
 */
export const OWN_CRAWLER_TOKEN = 'LlmoTrackerSiteAudit'
export const OWN_USER_AGENT = `Mozilla/5.0 (compatible; ${OWN_CRAWLER_TOKEN}/1.0; AI search readiness audit for the registered site owner)`
