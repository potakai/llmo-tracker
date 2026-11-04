'use client'

import { type FormEvent, useState } from 'react'
import { api } from '@/lib/api-client'
import { useAction } from '@/lib/use-action'

type Brand = {
  id: string
  name: string
  aliases: string[]
  domain: string | null
  samplesPerPrompt: number
  providers: ('openai' | 'gemini')[]
  scheduleEnabled: boolean
}

/** ブランド名・別名・ドメイン・計測の設定 */
export function BrandInfoForm({ brand, readOnly }: { brand: Brand; readOnly: boolean }) {
  const { run, error, pending } = useAction()
  const [saved, setSaved] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    const form = new FormData(event.currentTarget)
    const domain = String(form.get('domain') ?? '').trim()
    const ok = await run(() =>
      api.brands[':brandId'].$patch({
        param: { brandId: brand.id },
        json: {
          name: String(form.get('name')),
          aliases: String(form.get('aliases') ?? '')
            .split(/[、,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
          domain: domain || null,
          samplesPerPrompt: Number(form.get('samples')),
          providers: form.getAll('providers').map(String) as Brand['providers'],
          scheduleEnabled: form.get('schedule') === 'on',
        },
      }),
    )
    setSaved(ok)
  }

  return (
    <section aria-labelledby="brand-settings-heading">
      <h2 id="brand-settings-heading" className="text-lg font-bold">
        ブランドと計測の設定
      </h2>
      <form onSubmit={save} className="mt-4 flex flex-col gap-5" onChange={() => setSaved(false)}>
        <fieldset disabled={readOnly} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="brand-name" className="text-sm">
              ブランド名
            </label>
            <input
              id="brand-name"
              name="name"
              defaultValue={brand.name}
              required
              maxLength={100}
              className="field"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="brand-aliases" className="text-sm">
              別の呼び方（読点区切り、10個まで）
            </label>
            <input
              id="brand-aliases"
              name="aliases"
              defaultValue={brand.aliases.join('、')}
              className="field"
              aria-describedby="brand-aliases-hint"
            />
            <span id="brand-aliases-hint" className="text-xs text-ink-soft">
              英語名や略称など。AI の回答でこの呼び方が出ても、自社として数えます
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="brand-domain" className="text-sm">
              自社サイトのドメイン
            </label>
            <input
              id="brand-domain"
              name="domain"
              defaultValue={brand.domain ?? ''}
              className="field"
              placeholder="example.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="brand-samples" className="text-sm">
              1 回の計測で同じ質問を聞く回数
            </label>
            <select
              id="brand-samples"
              name="samples"
              defaultValue={brand.samplesPerPrompt}
              className="field max-w-40"
              aria-describedby="brand-samples-hint"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} 回
                </option>
              ))}
            </select>
            <span id="brand-samples-hint" className="text-xs text-ink-soft">
              回数を増やすと数字は安定しますが、そのぶん費用がかかります
            </span>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm">計測する AI</legend>
            <div className="flex gap-5">
              {(
                [
                  ['openai', 'ChatGPT'],
                  ['gemini', 'Gemini'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="providers"
                    value={value}
                    defaultChecked={brand.providers.includes(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="schedule" defaultChecked={brand.scheduleEnabled} />
            毎日自動で計測する
          </label>
        </fieldset>

        <div className="flex items-center gap-4">
          <button type="submit" className="btn-primary" disabled={readOnly || pending}>
            設定を保存
          </button>
          {saved && (
            <p role="status" className="text-sm">
              保存しました
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
