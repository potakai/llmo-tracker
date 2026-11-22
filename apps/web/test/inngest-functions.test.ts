import { describe, expect, it } from 'vitest'
import { functions } from '@/inngest/functions'

/**
 * Inngest の関数の設定と、本体が動かすステップ。opts / fn は SDK の内部の形なので、
 * テストの中だけで読む（SDK を上げて形が変わったら、このテストを直す）
 */
type FunctionInternals = {
  id: () => string
  opts: { triggers?: { cron?: string; event?: string }[] }
  fn: (ctx: unknown) => Promise<unknown>
}

const internals = (id: string): FunctionInternals => {
  const found = functions.find((f) => f.id() === id)
  if (!found) throw new Error(`関数 ${id} がありません`)
  return found as unknown as FunctionInternals
}

/** 本体を、ステップを実行せずに名前だけ記録して動かす */
async function stepNamesOf(id: string): Promise<string[]> {
  const names: string[] = []
  const step = {
    run: async (name: string) => {
      names.push(name)
      return name === 'recover-stale-runs' ? [] : 0
    },
  }
  const logger = { info: () => {}, warn: () => {}, error: () => {} }
  await internals(id).fn({ step, logger, event: { ts: Date.now() } })
  return names
}

describe('止まった run と、Google の検索の回収', () => {
  it('run の回収と Google の検索の回収は別の関数で、どちらも 10 分ごとに動く（片方のリトライが尽きても、もう片方は動く）', () => {
    expect(internals('recover-stale-runs').opts.triggers).toEqual([{ cron: '*/10 * * * *' }])
    expect(internals('recover-stale-serp').opts.triggers).toEqual([{ cron: '*/10 * * * *' }])
  })

  it('run の回収は Google の検索を回収せず、Google の検索の回収は run を回収しない', async () => {
    expect(await stepNamesOf('recover-stale-runs')).toEqual(['recover-stale-runs'])
    expect(await stepNamesOf('recover-stale-serp')).toEqual(['recover-stale-serp'])
  })
})
