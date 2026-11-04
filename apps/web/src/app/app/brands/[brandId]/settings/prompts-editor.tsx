'use client'

import { type FormEvent, useRef } from 'react'
import { api } from '@/lib/api-client'
import { useAction } from '@/lib/use-action'

type Prompt = { id: string; text: string; archived: boolean }

/**
 * 質問の追加・アーカイブ・復元。
 * 文面の書き換えはできない（変えると過去の計測と比べられなくなる）。変えたいときは、
 * 古い質問をアーカイブして新しく追加する。
 */
export function PromptsEditor(props: {
  brandId: string
  prompts: Prompt[]
  max: number
  readOnly: boolean
}) {
  const { run, error, pending } = useAction()
  const formRef = useRef<HTMLFormElement>(null)
  const active = props.prompts.filter((p) => !p.archived)
  const archived = props.prompts.filter((p) => p.archived)
  const full = active.length >= props.max
  const param = { brandId: props.brandId }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = String(new FormData(event.currentTarget).get('text') ?? '')
    const ok = await run(() => api.brands[':brandId'].prompts.$post({ param, json: { text } }))
    if (ok) formRef.current?.reset()
  }

  return (
    <section aria-labelledby="prompts-settings-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="prompts-settings-heading" className="text-lg font-bold">
          AI に聞く質問
        </h2>
        <p className="num text-sm text-ink-soft">
          {active.length} / {props.max} 個
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        文面を変えると過去の計測と比べられなくなるので、変えたいときはアーカイブして新しく追加してください。
        アーカイブした質問の過去の回答は残ります。
      </p>

      <ul className="panel mt-4 divide-y divide-rule">
        {active.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0">{p.text}</span>
            <button
              type="button"
              className="btn-quiet shrink-0 px-3 py-1 text-sm"
              disabled={props.readOnly || pending}
              onClick={() =>
                run(() =>
                  api.brands[':brandId'].prompts[':promptId'].archive.$post({
                    param: { ...param, promptId: p.id },
                  }),
                )
              }
            >
              アーカイブ
            </button>
          </li>
        ))}
        {active.length === 0 && (
          <li className="px-4 py-3 text-sm text-ink-soft">
            有効な質問がありません。計測するには 1 つ以上追加してください。
          </li>
        )}
      </ul>

      <form ref={formRef} onSubmit={add} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-prompt" className="sr-only">
          追加する質問
        </label>
        <input
          id="new-prompt"
          name="text"
          required
          maxLength={500}
          className="field"
          placeholder={
            full ? `質問は ${props.max} 個までです` : '例：個人事業主が使いやすいクラウド会計は？'
          }
          disabled={props.readOnly || full}
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={props.readOnly || full || pending}
        >
          質問を追加
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {archived.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm text-ink-soft">
            アーカイブした質問（{archived.length} 個）
          </summary>
          <ul className="panel mt-2 divide-y divide-rule">
            {archived.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 text-ink-soft">{p.text}</span>
                <button
                  type="button"
                  className="btn-quiet shrink-0 px-3 py-1 text-sm"
                  disabled={props.readOnly || full || pending}
                  onClick={() =>
                    run(() =>
                      api.brands[':brandId'].prompts[':promptId'].restore.$post({
                        param: { ...param, promptId: p.id },
                      }),
                    )
                  }
                >
                  元に戻す
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
