import { isFakeModel, type LlmMode } from '@llmo/llm'

/**
 * 計測の詳細に出す、サンプルの AI（fake）についての注記：
 * - all：全部がサンプルの回答（live にする前の計測など）
 * - mixed：サンプルと本物が混ざっている（計測の途中で live に切り替わったなど）。live の組織だけ
 */
export type SampleRunNotice = { kind: 'all' } | { kind: 'mixed'; sampleCount: number } | null

/** 計測の回答のモデル名から、出す注記を決める */
export function sampleRunNotice(models: readonly string[], llmMode: LlmMode): SampleRunNotice {
  const sampleCount = models.filter(isFakeModel).length
  if (sampleCount === 0) return null
  if (sampleCount === models.length) return { kind: 'all' }
  // fake の組織では何も集計から外していないので、「外しています」の注記は出さない
  return llmMode === 'live' ? { kind: 'mixed', sampleCount } : null
}
