/**
 * API キーの動作確認用。本物の API に 1 回だけ質問して、結果と費用の見積もりを表示する。
 *   pnpm ask "中小企業向けのおすすめ会計ソフトは？"
 *   pnpm ask "..." gemini
 */
import { createProvidersFromEnv, estimateCostUsd, type ProviderId } from '../index'

const [prompt, providerArg = 'openai'] = process.argv.slice(2)
if (!prompt) {
  console.error('使い方: pnpm ask "質問" [openai|gemini]')
  process.exit(1)
}
if (providerArg !== 'openai' && providerArg !== 'gemini') {
  console.error('プロバイダーは openai か gemini を指定してください')
  process.exit(1)
}

const providers = createProvidersFromEnv({ ...process.env, LLM_MODE: 'live' })
const provider = providers[providerArg as ProviderId]
console.log(`→ ${provider.id} (${provider.model}) に質問中...\n`)

const result = await provider.ask({ prompt, abortSignal: AbortSignal.timeout(120_000) })
const cost = estimateCostUsd(result)

console.log(result.text)
console.log('\n--- 引用元 ---')
for (const [i, s] of result.sources.entries()) console.log(`${i + 1}. ${s.title ?? ''} ${s.url}`)
console.log('\n--- 計測 ---')
console.log({
  model: result.model,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  searchCount: result.searchCount,
  latencyMs: result.latencyMs,
  costUsd: cost,
})
