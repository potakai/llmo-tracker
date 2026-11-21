import { parseArgs } from 'node:util'

export type ExtractorKind = 'rule' | 'llm'

export type EvalArgs = {
  extractor: ExtractorKind
  /** このケースだけ流す（id） */
  only: string | null
  concurrency: number
  /** 保存済みの LLM の結果ファイル。指定すると API を呼ばず、突き合わせだけをやり直す */
  replay: string | null
}

export const USAGE =
  '使い方: pnpm --filter @llmo/llm eval -- --extractor rule|llm [--only <id>] [--concurrency 4] [--replay <results.json>]'

const DEFAULT_CONCURRENCY = 4

/** コマンドラインの引数を解釈する。おかしければ使い方つきのエラーを投げる */
export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  // pnpm は `pnpm eval -- --extractor rule` の `--` もそのまま渡してくる
  const args = argv.filter((a) => a !== '--')
  const { values } = parseArgs({
    args,
    options: {
      extractor: { type: 'string' },
      only: { type: 'string' },
      concurrency: { type: 'string' },
      replay: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  })

  const extractor = values.extractor
  if (extractor !== 'rule' && extractor !== 'llm') {
    throw new Error(`--extractor には rule か llm を指定してください\n${USAGE}`)
  }

  const concurrency =
    values.concurrency === undefined ? DEFAULT_CONCURRENCY : Number(values.concurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency には 1 以上の整数を指定してください\n${USAGE}`)
  }

  const replay = values.replay ?? null
  if (replay !== null && extractor !== 'llm') {
    throw new Error(`--replay は --extractor llm と一緒に指定してください\n${USAGE}`)
  }

  return { extractor, only: values.only ?? null, concurrency, replay }
}
