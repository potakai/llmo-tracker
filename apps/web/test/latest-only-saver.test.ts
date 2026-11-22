import { describe, expect, it } from 'vitest'
import { createLatestOnlySaver } from '@/lib/latest-only-saver'

/** 保存の呼び出しを記録し、応答のタイミングをテストから決められる保存先 */
function controllableSave() {
  const calls: string[] = []
  const pending: { value: string; resolve: (ok: boolean) => void }[] = []
  let inFlight = 0
  let maxInFlight = 0
  /** サーバーの Cookie（届いた順に上書きされる） */
  let stored: string | null = null
  const save = (value: string) =>
    new Promise<boolean>((resolve) => {
      calls.push(value)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      pending.push({
        value,
        resolve: (ok) => {
          inFlight -= 1
          if (ok) stored = value
          resolve(ok)
        },
      })
    })
  /** 届いている保存のうち、i 番目に応答する（後から届いた順に応答させることもできる） */
  const respond = async (index: number, ok = true) => {
    const target = pending.splice(index, 1)[0]
    target?.resolve(ok)
    // 応答のあとに次の保存が始まるのを待つ
    await new Promise((r) => setTimeout(r, 0))
  }
  return {
    save,
    respond,
    calls,
    get stored() {
      return stored
    },
    get maxInFlight() {
      return maxInFlight
    },
    get pendingCount() {
      return pending.length
    },
  }
}

describe('createLatestOnlySaver', () => {
  it('素早く A → B → C と切り替えると、保存は 1 つずつ順に行われ、最後に C が残る', async () => {
    const server = controllableSave()
    const saver = createLatestOnlySaver(server.save, null)

    const done = saver.request('A')
    saver.request('B')
    saver.request('C')
    // A の応答を待つあいだは、次の保存を送らない
    expect(server.calls).toEqual(['A'])
    expect(server.pendingCount).toBe(1)

    await server.respond(0)
    // 途中の B は飛ばして、最後に選んだ C だけを送る
    expect(server.calls).toEqual(['A', 'C'])
    await server.respond(0)
    await done

    expect(server.maxInFlight).toBe(1)
    expect(server.stored).toBe('C')
    expect(saver.saved()).toBe('C')
  })

  it('保存済みのものをもう一度頼んでも送らない', async () => {
    const server = controllableSave()
    const saver = createLatestOnlySaver(server.save, 'A')
    await saver.request('A')
    expect(server.calls).toEqual([])
  })

  it('失敗した（res.ok でない）ときは保存できていないものとして扱い、同じものをまた頼むと送り直す', async () => {
    const server = controllableSave()
    const saver = createLatestOnlySaver(server.save, 'A')

    const first = saver.request('B')
    await server.respond(0, false)
    await first
    expect(saver.saved()).toBeNull()
    // 失敗したものを何度も送り続けない
    expect(server.calls).toEqual(['B'])

    const second = saver.request('B')
    await server.respond(0)
    await second
    expect(server.calls).toEqual(['B', 'B'])
    expect(saver.saved()).toBe('B')
  })

  it('失敗しているあいだに次が頼まれていたら、次を送る', async () => {
    const server = controllableSave()
    const saver = createLatestOnlySaver(server.save, null)

    const done = saver.request('A')
    saver.request('B')
    await server.respond(0, false)
    expect(server.calls).toEqual(['A', 'B'])
    await server.respond(0)
    await done
    expect(saver.saved()).toBe('B')
  })

  it('保存が例外を投げても止まらず、保存できていないものとして扱う', async () => {
    let calls = 0
    // 次のタイミングで失敗させる（送り続けるバグがあっても、テストがタイムアウトで落ちるように）
    const saver = createLatestOnlySaver(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 0))
      throw new Error('通信に失敗')
    }, 'A')
    await saver.request('B')
    expect(saver.saved()).toBeNull()
    expect(calls).toBe(1)
  })
})
