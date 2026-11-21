import { PROMPT_KIND_LABEL } from './labels'

/** 質問の種類（質問文・キーワード）のラベル。設定と計測結果で同じ見た目にする */
export function PromptKindBadge(props: {
  kind: keyof typeof PROMPT_KIND_LABEL
  className?: string
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-sm border border-rule px-1.5 align-[0.1em] text-xs text-ink-soft ${props.className ?? ''}`}
    >
      {PROMPT_KIND_LABEL[props.kind]}
    </span>
  )
}
