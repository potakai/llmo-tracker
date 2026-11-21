import pLimit from 'p-limit'

/** 1 回の質問・抽出の上限時間の初期値 */
export const DEFAULT_TIMEOUT_MS = 120_000

/**
 * items を concurrency 件ずつ並べて処理する。deadline（Date.now() の値）を過ぎたら新しく始めるのをやめ、
 * 始めたものが終わるのを待って返す。何も進まないまま区切り続けないよう、最初の 1 件は必ず始める。
 *
 * @returns 処理した件数。items.length より少なければ、締め切りで残りを見送った
 */
export async function runUntilDeadline<T>(
  items: readonly T[],
  options: { concurrency: number; deadline: number },
  fn: (item: T) => Promise<void>,
): Promise<number> {
  const limit = pLimit(options.concurrency)
  let started = 0
  const results = await Promise.all(
    items.map((item) =>
      limit(async () => {
        if (started > 0 && Date.now() >= options.deadline) return false
        started += 1
        await fn(item)
        return true
      }),
    ),
  )
  return results.filter(Boolean).length
}
