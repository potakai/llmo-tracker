import {
  createExtractorFromEnv,
  createProvidersFromEnv,
  type Extractor,
  type Providers,
} from '@llmo/llm'
import { executeRun } from '@llmo/runner'
import { after } from 'next/server'
import { db } from '@/lib/db'

let deps: { providers: Providers; extractor: Extractor } | undefined
// 最初に使うときに作る（フェイクモードなら API キーがなくても起動できるように）
const getDeps = () => {
  deps ??= {
    providers: createProvidersFromEnv(process.env),
    extractor: createExtractorFromEnv(process.env),
  }
  return deps
}

/**
 * 開発用：レスポンスを返したあとに、同じプロセスで run を実行する。
 * サーバーレス環境では実行時間の上限があるので、本番は Trigger.dev に切り替える。
 */
export function dispatchInProcess(runId: string) {
  after(async () => {
    try {
      const summary = await executeRun({ db, ...getDeps() }, runId)
      console.info('[run]', summary)
    } catch (error) {
      console.error('[run] 失敗', runId, error)
    }
  })
}
