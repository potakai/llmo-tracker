'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { api } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'

const lines = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

type Issue = { path?: (string | number)[]; message: string }

export function OnboardingForm({ hasOrganization }: { hasOrganization: boolean }) {
  const router = useRouter()
  const [step, setStep] = useState<'organization' | 'brand'>(
    hasOrganization ? 'brand' : 'organization',
  )
  const [pending, setPending] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('organization'))
    setPending(true)
    const result = await authClient.organization.create({
      name,
      slug: `org-${crypto.randomUUID().slice(0, 8)}`,
    })
    setPending(false)
    if (result.error) {
      setIssues([{ message: result.error.message ?? '組織を作れませんでした' }])
      return
    }
    setIssues([])
    setStep('brand')
  }

  async function createBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const domain = String(form.get('domain') ?? '').trim()
    setPending(true)
    const res = await api.brands.$post({
      json: {
        name: String(form.get('name')),
        domain: domain || undefined,
        competitors: lines(form.get('competitors')).map((name) => ({ name })),
        prompts: lines(form.get('prompts')),
      },
    })
    setPending(false)
    const body = await res.json()
    if ('brand' in body) {
      router.push(`/app/brands/${body.brand.id}`)
      return
    }
    const issuesFromApi = body.error.issues as Issue[] | undefined
    setIssues(issuesFromApi ?? [{ message: body.error.message }])
  }

  const issueFor = (field: string) => issues.find((i) => i.path?.[0] === field)?.message
  const generalIssues = issues.filter((i) => !i.path)

  return (
    <div className="mt-8">
      <ol className="mb-8 flex gap-6 text-sm" aria-label="手順">
        <li className={step === 'organization' ? 'font-bold' : 'text-ink-soft'}>1. 組織</li>
        <li className={step === 'brand' ? 'font-bold' : 'text-ink-soft'}>2. 計測するブランド</li>
      </ol>

      {step === 'organization' ? (
        <form onSubmit={createOrganization} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm">組織の名前（会社名やチーム名）</span>
            <input name="organization" required maxLength={100} className="field" />
          </label>
          <Issues issues={generalIssues} />
          <button type="submit" className="btn-primary self-start" disabled={pending}>
            次へ
          </button>
        </form>
      ) : (
        <form onSubmit={createBrand} className="flex flex-col gap-5">
          <Field id="brand-name" label="自社のブランド名" error={issueFor('name')}>
            <input
              id="brand-name"
              name="name"
              required
              maxLength={100}
              className="field"
              placeholder="サンプル会計"
            />
          </Field>
          <Field
            id="brand-domain"
            label="自社サイトのドメイン（任意）"
            hint="AI が自社サイトを引用したかを見分けるのに使います"
            error={issueFor('domain')}
          >
            <input
              id="brand-domain"
              name="domain"
              className="field"
              placeholder="sample-kaikei.example.com"
            />
          </Field>
          <Field
            id="brand-competitors"
            label="競合（1行に1社、10社まで）"
            error={issueFor('competitors')}
          >
            <textarea
              id="brand-competitors"
              name="competitors"
              rows={4}
              className="field"
              placeholder={'ミライ会計\nラクラク帳簿'}
            />
          </Field>
          <Field
            id="brand-prompts"
            label="AI に聞く質問（1行に1つ、10個まで）"
            hint="お客さんが実際に AI に聞きそうな言い方で書くと、実態に近い数字になります"
            error={issueFor('prompts')}
          >
            <textarea
              id="brand-prompts"
              name="prompts"
              rows={5}
              required
              className="field"
              placeholder={
                '中小企業向けのおすすめ会計ソフトは？\n個人事業主が使いやすいクラウド会計は？'
              }
            />
          </Field>
          <Issues issues={generalIssues} />
          <button type="submit" className="btn-primary self-start" disabled={pending}>
            登録して計測画面へ
          </button>
        </form>
      )}
    </div>
  )
}

function Field(props: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-sm">
        {props.label}
      </label>
      {props.children}
      {props.hint && <span className="text-xs text-ink-soft">{props.hint}</span>}
      {props.error && (
        <span role="alert" className="text-sm text-danger">
          {props.error}
        </span>
      )}
    </div>
  )
}

function Issues({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  return (
    <ul role="alert" className="text-sm text-danger">
      {issues.map((issue) => (
        <li key={issue.message}>{issue.message}</li>
      ))}
    </ul>
  )
}
