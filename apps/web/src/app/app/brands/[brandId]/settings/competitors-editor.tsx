'use client'

import { type FormEvent, useRef, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAction } from '@/lib/use-action'

type Competitor = { id: string; name: string; domain: string | null }

type CompetitorsEditorProps = {
  brandId: string
  competitors: Competitor[]
  max: number
  readOnly: boolean
}

/** フォームの名前とドメインを読む。ドメインは空なら未設定（形をそろえるのはサーバー） */
function readCompetitorForm(form: HTMLFormElement) {
  const data = new FormData(form)
  const domain = String(data.get('domain') ?? '').trim()
  return { name: String(data.get('name') ?? ''), domain: domain || null }
}

/**
 * 競合の追加・名前とドメインの変更・削除。名前を変えても、過去の言及はその競合にひもづいたまま。
 * ドメインは Google の検索順位の照合に使う
 */
export function CompetitorsEditor(props: CompetitorsEditorProps) {
  const { run, error, pending } = useAction()
  const [editing, setEditing] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const full = props.competitors.length >= props.max
  const param = { brandId: props.brandId }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { name, domain } = readCompetitorForm(event.currentTarget)
    const ok = await run(() =>
      api.brands[':brandId'].competitors.$post({
        param,
        json: { name, domain: domain ?? undefined },
      }),
    )
    if (ok) formRef.current?.reset()
  }

  async function update(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const ok = await run(() =>
      api.brands[':brandId'].competitors[':competitorId'].$patch({
        param: { ...param, competitorId: id },
        json: readCompetitorForm(event.currentTarget),
      }),
    )
    if (ok) setEditing(null)
  }

  function remove(c: Competitor) {
    if (!window.confirm(`「${c.name}」を競合から削除しますか？`)) return
    run(() =>
      api.brands[':brandId'].competitors[':competitorId'].$delete({
        param: { ...param, competitorId: c.id },
      }),
    )
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
        ドメインを入れると、Google
        の検索順位を競合でも比べられます。削除しても、過去の回答に出てきた名前は残ります（未登録の会社として数えられます）。
      </p>

      <ul className="panel mt-4 divide-y divide-rule">
        {props.competitors.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="px-4 py-2.5">
              <EditCompetitorForm
                competitor={c}
                pending={pending}
                onSubmit={(e) => update(e, c.id)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                {c.name}
                <span className="block text-xs text-ink-soft">{c.domain ?? 'ドメイン未設定'}</span>
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="btn-quiet px-3 py-1 text-sm"
                  disabled={props.readOnly || pending}
                  onClick={() => setEditing(c.id)}
                >
                  編集
                </button>
                <button
                  type="button"
                  className="btn-quiet px-3 py-1 text-sm text-danger"
                  disabled={props.readOnly || pending}
                  onClick={() => remove(c)}
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
        <label htmlFor="new-competitor-domain" className="sr-only">
          追加する競合のドメイン（任意）
        </label>
        <input
          id="new-competitor-domain"
          name="domain"
          className="field"
          placeholder="ドメイン（任意）例：mirai.example.com"
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

type EditCompetitorFormProps = {
  competitor: Competitor
  pending: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}

/** 1 社分の名前とドメインを変えるフォーム。ドメインを空にすると未設定に戻る */
function EditCompetitorForm({
  competitor: c,
  pending,
  onSubmit,
  onCancel,
}: EditCompetitorFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor={`competitor-name-${c.id}`} className="sr-only">
        {c.name} の名前
      </label>
      <input
        id={`competitor-name-${c.id}`}
        name="name"
        defaultValue={c.name}
        required
        maxLength={100}
        className="field"
        // biome-ignore lint/a11y/noAutofocus: 「編集」を押した直後に入力できるようにする
        autoFocus
      />
      <label htmlFor={`competitor-domain-${c.id}`} className="sr-only">
        {c.name} のドメイン
      </label>
      <input
        id={`competitor-domain-${c.id}`}
        name="domain"
        defaultValue={c.domain ?? ''}
        className="field"
        placeholder="ドメイン（任意）例：example.com"
      />
      <div className="flex shrink-0 gap-2">
        <button type="submit" className="btn-primary px-3 py-1 text-sm" disabled={pending}>
          保存
        </button>
        <button type="button" className="btn-quiet px-3 py-1 text-sm" onClick={onCancel}>
          やめる
        </button>
      </div>
    </form>
  )
}
