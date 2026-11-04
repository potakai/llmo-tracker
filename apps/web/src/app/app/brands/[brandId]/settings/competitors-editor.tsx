'use client'

import { type FormEvent, useRef, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAction } from '@/lib/use-action'

type Competitor = { id: string; name: string }

/** 競合の追加・名前の変更・削除。名前を変えても、過去の言及はその競合にひもづいたまま */
export function CompetitorsEditor(props: {
  brandId: string
  competitors: Competitor[]
  max: number
  readOnly: boolean
}) {
  const { run, error, pending } = useAction()
  const [editing, setEditing] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const full = props.competitors.length >= props.max
  const param = { brandId: props.brandId }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '')
    const ok = await run(() => api.brands[':brandId'].competitors.$post({ param, json: { name } }))
    if (ok) formRef.current?.reset()
  }

  async function rename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '')
    const ok = await run(() =>
      api.brands[':brandId'].competitors[':competitorId'].$patch({
        param: { ...param, competitorId: id },
        json: { name },
      }),
    )
    if (ok) setEditing(null)
  }

  return (
    <section aria-labelledby="competitors-settings-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="competitors-settings-heading" className="text-lg font-bold">
          競合
        </h2>
        <p className="num text-sm text-ink-soft">
          {props.competitors.length} / {props.max} 社
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        削除しても、過去の回答に出てきた名前は残ります（未登録の会社として数えられます）。
      </p>

      <ul className="panel mt-4 divide-y divide-rule">
        {props.competitors.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="px-4 py-2.5">
              <form onSubmit={(e) => rename(e, c.id)} className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor={`rename-${c.id}`} className="sr-only">
                  {c.name} の新しい名前
                </label>
                <input
                  id={`rename-${c.id}`}
                  name="name"
                  defaultValue={c.name}
                  required
                  maxLength={100}
                  className="field"
                  // biome-ignore lint/a11y/noAutofocus: 「名前を変える」を押した直後に入力できるようにする
                  autoFocus
                />
                <div className="flex shrink-0 gap-2">
                  <button
                    type="submit"
                    className="btn-primary px-3 py-1 text-sm"
                    disabled={pending}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="btn-quiet px-3 py-1 text-sm"
                    onClick={() => setEditing(null)}
                  >
                    やめる
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">{c.name}</span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="btn-quiet px-3 py-1 text-sm"
                  disabled={props.readOnly || pending}
                  onClick={() => setEditing(c.id)}
                >
                  名前を変える
                </button>
                <button
                  type="button"
                  className="btn-quiet px-3 py-1 text-sm text-danger"
                  disabled={props.readOnly || pending}
                  onClick={() => {
                    if (!window.confirm(`「${c.name}」を競合から削除しますか？`)) return
                    run(() =>
                      api.brands[':brandId'].competitors[':competitorId'].$delete({
                        param: { ...param, competitorId: c.id },
                      }),
                    )
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ),
        )}
        {props.competitors.length === 0 && (
          <li className="px-4 py-3 text-sm text-ink-soft">競合はまだ登録されていません。</li>
        )}
      </ul>

      <form ref={formRef} onSubmit={add} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-competitor" className="sr-only">
          追加する競合の名前
        </label>
        <input
          id="new-competitor"
          name="name"
          required
          maxLength={100}
          className="field"
          placeholder={full ? `競合は ${props.max} 社までです` : '例：ミライ会計'}
          disabled={props.readOnly || full}
        />
        <button
          type="submit"
          className="btn-primary shrink-0"
          disabled={props.readOnly || full || pending}
        >
          競合を追加
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
