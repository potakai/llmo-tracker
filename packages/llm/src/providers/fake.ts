import type { AnswerProvider, AskInput, AskResult, ProviderId } from '../types'

/**
 * API を叩かないフェイク。開発・テスト・公開デモで使う（費用がかからない）。
 * 乱数ではなく「質問文＋呼ばれた回数」のハッシュで回答を組み立てるので、
 * サンプルごとに少しずつ違う回答になり、言及率にばらつきが出る。
 */
export function createFakeProvider(
  id: ProviderId,
  options: {
    /** これに当てはまる質問では失敗する（失敗時の動きのテスト用） */
    failWhen?: (input: AskInput) => boolean
    delayMs?: number
  } = {},
): AnswerProvider {
  let callCount = 0
  return {
    id,
    model: `fake-${id}`,
    async ask(input) {
      callCount += 1
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs))
      if (options.failWhen?.(input)) throw new Error(`fake ${id}: 意図的な失敗`)

      const names = input.fakeHints?.names ?? ['サービスA', 'サービスB', 'サービスC']
      const seed = hash(`${id}:${input.prompt}:${callCount}`)
      // 名前の並びと、出てくる数をハッシュで決める
      const picked = rotate(names, seed % Math.max(names.length, 1)).slice(
        0,
        1 + (seed % Math.max(names.length, 1)),
      )
      const text = [
        `「${input.prompt}」へのおすすめは次のとおりです。`,
        ...picked.map((name, i) => `${i + 1}. ${name}：使いやすさに定評があります。`),
      ].join('\n')

      const result: AskResult = {
        provider: id,
        model: `fake-${id}`,
        text,
        sources: picked.map((name, i) => ({
          url: `https://example.com/${encodeURIComponent(name)}?ref=${i}`,
          title: `${name} の比較記事`,
        })),
        inputTokens: 20 + input.prompt.length,
        outputTokens: text.length,
        searchCount: 1,
        latencyMs: options.delayMs ?? 0,
      }
      return result
    },
  }
}

function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rotate<T>(items: T[], by: number): T[] {
  return [...items.slice(by), ...items.slice(0, by)]
}
