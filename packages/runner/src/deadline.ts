import pLimit from 'p-limit'

/**
 * items を concurrency 件ずつ並べて処理する。deadline（Date.now() の値）を過ぎたら新しく始めるのをやめ、
 * 始めたものが終わるのを待って返す。何も進まないまま区切り続けないよう、最初の 1 件は必ず始める。
 *
 * @returns すべて処理したら true、締め切りで残りを見送ったら false
 */
export async function runUntilDeadline<T>(
  items: readonly T[],
  options: { concurrency: number; deadline: number },
  fn: (item: T) => Promise<void>,
): Promise<boolean> {
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
  return results.every(Boolean)
}
