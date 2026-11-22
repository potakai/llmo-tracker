'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { api } from '@/lib/api-client'
import type { AnswerCosts } from '@/lib/daily-cost'
import { splitLines, splitList } from '@/lib/form-lists'
import { DailyCostEstimate } from './daily-cost-estimate'
import type { ProviderKey } from './labels'

/** 新しいブランドの初期値（API の既定値と同じ）。費用の目安の計算に使う */
const DEFAULT_SAMPLES_PER_PROMPT = 5
const DEFAULT_PROVIDERS: readonly ProviderKey[] = ['openai', 'gemini']

export type Issue = { path?: (string | number)[]; message: string }

/**
 * ブランドの登録フォーム（ブランド名・別名・ドメイン・競合・質問・キーワード）。
 * 初期設定（/onboarding）と、2 社目以降の追加（/app/brands/new）で使い回す。
 * 登録したら、そのブランドの画面へ移る
 */
export function BrandForm({
  submitLabel,
  answerCosts,
}: {
  submitLabel: string
  /** 本物の AI で計測する組織なら、1 回答あたりの費用の目安。あれば費用の目安を出す */
  answerCosts?: AnswerCosts
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [promptCount, setPromptCount] = useState(0)

  function countPrompts(form: HTMLFormElement) {
    const data = new FormData(form)
    setPromptCount(splitLines(data.get('prompts')).length + splitLines(data.get('keywords')).length)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const domain = String(form.get('domain') ?? '').trim()
    setPending(true)
    let res: Response
    try {
      res = await api.brands.$post({
        json: {
          name: String(form.get('name')),
          aliases: splitList(form.get('aliases')),
          domain: domain || undefined,
          competitors: splitLines(form.get('competitors')).map((name) => ({ name })),
          prompts: [
            ...splitLines(form.get('prompts')).map((text) => ({ text, kind: 'question' as const })),
            ...splitLines(form.get('keywords')).map((text) => ({ text, kind: 'keyword' as const })),
          ],
        },
      })
    } catch {
      setPending(false)
      setIssues([{ message: '通信に失敗しました。接続を確かめて、もう一度試してください' }])
      return
    }
    setPending(false)
    const body = (await res.json().catch(() => ({}))) as {
      brand?: { id: string }
      error?: { message: string; issues?: Issue[] }
    }
    if (body.brand) {
      // Next.js は画面を移るとき、新しいページ（page.tsx）の上端が画面内に見えていればスクロール位置を引き継ぐ。
      // ブランドの画面は page.tsx の上に案内や見出し（layout.tsx）があるので、フォームの下までスクロールしたまま
      // 移ると、それらが画面の上にはみ出して見えなくなる。先に一番上へ戻しておく
      window.scrollTo(0, 0)
      router.push(`/app/brands/${body.brand.id}`)
      router.refresh()
      return
    }
    setIssues(body.error?.issues ?? [{ message: body.error?.message ?? '登録できませんでした' }])
  }

  const issueFor = (field: string) => issues.find((i) => i.path?.[0] === field)?.message
  const generalIssues = issues.filter((i) => !i.path)

  return (
    <form
      onSubmit={submit}
      onChange={(event) => countPrompts(event.currentTarget)}
      className="flex flex-col gap-5"
    >
      <Field id="brand-name" label="ブランド名" error={issueFor('name')}>
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
        id="brand-aliases"
        label="別の呼び方（任意。読点区切り、10個まで）"
        hint="英語名や略称など。AI の回答でこの呼び方が出ても、このブランドとして数えます"
        error={issueFor('aliases')}
      >
        <input
          id="brand-aliases"
          name="aliases"
          className="field"
          placeholder="Sample Kaikei、サンプル"
        />
      </Field>
      <Field
        id="brand-domain"
        label="サイトのドメイン（任意）"
        hint="AI がこのブランドのサイトを引用したかを見分けるのに使います"
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
        label="AI に聞く質問（1行に1つ）"
        hint="お客さんが実際に AI に聞きそうな言い方で書くと、実態に近い数字になります"
        error={issueFor('prompts')}
      >
        <textarea
          id="brand-prompts"
          name="prompts"
          rows={5}
          className="field"
          placeholder={
            '中小企業向けのおすすめ会計ソフトは？\n個人事業主が使いやすいクラウド会計は？'
          }
        />
      </Field>
      <Field
        id="brand-keywords"
        label="検索キーワード（任意。1行に1つ）"
        hint="「会計ソフト おすすめ」のように単語を並べた聞き方です。質問と合わせて10個まで"
      >
        <textarea
          id="brand-keywords"
          name="keywords"
          rows={3}
          className="field"
          placeholder={'会計ソフト おすすめ\nクラウド会計 比較'}
        />
      </Field>
      {answerCosts && (
        <DailyCostEstimate
          samplesPerPrompt={DEFAULT_SAMPLES_PER_PROMPT}
          promptCount={promptCount}
          providers={DEFAULT_PROVIDERS}
          costs={answerCosts}
        />
      )}
      <Issues issues={generalIssues} />
      <button type="submit" className="btn-primary self-start" disabled={pending}>
        {submitLabel}
      </button>
    </form>
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

export function Issues({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  return (
    <ul role="alert" className="text-sm text-danger">
      {issues.map((issue) => (
        <li key={issue.message}>{issue.message}</li>
      ))}
    </ul>
  )
}
