/** 保存する関数。保存できたら true（fetch なら res.ok）。例外は失敗として扱う */
export type SaveFn = (value: string) => Promise<boolean>

export type LatestOnlySaver = {
  /** value を保存してほしいと頼む。返り値は、頼まれた分の保存がひととおり終わったら解決する */
  request: (value: string) => Promise<void>
  /** 保存できているとわかっている値。失敗して状態がわからないときは null */
  saved: () => string | null
}

/**
 * 最後に頼まれた値だけが残るように、保存を 1 つずつ順に行う。
 * - 前の保存の応答を待ってから次を送るので、前の保存が後から届いて上書きすることがない
 * - 待っているあいだに何度も頼まれたら、途中の値は飛ばして最後の値だけを送る
 * - 失敗したら「保存できていない」として扱い、同じ値をまた頼まれたら送り直す
 *   （失敗した値を自分からは送り直さない。送り続けると、サーバーが落ちているときに止まらなくなる）
 */
export function createLatestOnlySaver(
  save: SaveFn,
  initiallySaved: string | null,
): LatestOnlySaver {
  let saved = initiallySaved
  let wanted: string | null = null
  let running: Promise<void> | null = null

  async function trySave(value: string): Promise<boolean> {
    try {
      return await save(value)
    } catch {
      return false
    }
  }

  async function drain() {
    while (wanted !== null && wanted !== saved) {
      const value = wanted
      const ok = await trySave(value)
      saved = ok ? value : null
      // 失敗して、そのあいだに新しく頼まれていなければ、ここで止める
      if (!ok && wanted === value) break
    }
    running = null
  }

  return {
    request(value) {
      wanted = value
      running ??= drain()
      return running
    },
    saved: () => saved,
  }
}
