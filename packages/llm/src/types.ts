/** 対象のAI。DB の provider enum と同じ値（runner 側で型が一致することを確認している） */
export type ProviderId = 'openai' | 'gemini'

export type AskInput = {
  /** ユーザーとして投げる質問文（system プロンプトは付けない：普通のユーザーの使い方に近づけるため） */
  prompt: string
  abortSignal?: AbortSignal
  /**
   * フェイク用のヒント。本物のプロバイダーは使わない。
   * フェイクはこの名前を混ぜて、それっぽい回答を作る
   */
  fakeHints?: { names: string[] }
}

export type Source = {
  url: string
  title?: string
}

export type AskResult = {
  provider: ProviderId
  /** 実際に使われたモデル名 */
  model: string
  text: string
  /** 回答の根拠として API が返した引用元（重複あり・順番どおり） */
  sources: Source[]
  inputTokens: number | null
  outputTokens: number | null
  /** Web 検索が何回走ったか（料金の計算に使う。取れなければ 0） */
  searchCount: number
  latencyMs: number
}

/** AI ごとの実装はこの形にそろえる。AI を足すときは、これを実装するだけでいい */
export interface AnswerProvider {
  readonly id: ProviderId
  readonly model: string
  ask(input: AskInput): Promise<AskResult>
}
