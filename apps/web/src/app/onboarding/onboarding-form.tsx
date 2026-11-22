'use client'

import { type FormEvent, useState } from 'react'
import { BrandForm, type Issue, Issues } from '@/components/brand-form'
import { authClient } from '@/lib/auth-client'

export function OnboardingForm({ hasOrganization }: { hasOrganization: boolean }) {
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
          <Issues issues={issues} />
          <button type="submit" className="btn-primary self-start" disabled={pending}>
            次へ
          </button>
        </form>
      ) : (
        <BrandForm submitLabel="登録して計測画面へ" />
      )}
    </div>
  )
}
