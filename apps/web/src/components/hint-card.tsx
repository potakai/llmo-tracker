import Link from 'next/link'
import type { ReactNode } from 'react'
import type {
  DomainCount,
  Hint,
  NegativeHint,
  OwnSiteHint,
  PromptHint,
  SiteHint,
} from '@/lib/hints'
import { formatDate, PROVIDER_LABEL, percent } from './labels'
import { ResponseItem, type ResponseView } from './response-item'

/** 根拠に出す回答（日付を出すため run の日付つき） */
export type EvidenceResponse = ResponseView & {
  run: { scheduledFor: string | null; createdAt: Date | string }
}

type HintCardProps = {
  hint: Hint
  /** 何番目の施策か（1 始まり） */
  order: number
  brandId: string
  evidence: Map<string, EvidenceResponse>
}

/** 施策 1 つ分の文章。「何が起きているか → なぜ大事か → 何をすればいいか」の順に出す */
type HintText = {
  title: ReactNode
  now: ReactNode
  why: string
  todo: ReactNode
  evidenceLabel: string
}

/** 「ミライ会計やラクラク帳簿」 */
const joinNames = (names: string[]) => (names.length > 0 ? names.join('や') : '競合')

const Num = ({ children }: { children: ReactNode }) => (
  <span className="num font-bold">{children}</span>
)

function siteText(hint: SiteHint): HintText {
  return {
    title: `${hint.domain} に、御社の情報を載せましょう`,
    now: (
      <>
        AI は{joinNames(hint.competitorNames)}をすすめるとき、{hint.domain}{' '}
        をよく参考にしています（競合の名前が出た回答の <Num>{percent(hint.competitorRate)}</Num>
        ）。御社の名前が出た回答では、
        {hint.brandRate === 0 ? (
          'まったく参考にされていません。'
        ) : (
          <>
            <Num>{percent(hint.brandRate)}</Num> にとどまります。
          </>
        )}
      </>
    ),
    why: 'AI は、よく参考にするサイトに載っている会社を、答えの中ですすめやすくなります。',
    todo: `${hint.domain} に御社の情報が載るように、掲載の申し込みや、記事に使ってもらえる情報の提供を検討しましょう。`,
    evidenceLabel: `${hint.domain} を参考にした回答を見る`,
  }
}

function promptText(hint: PromptHint): HintText {
  const top = hint.competitorNames[0] ?? '競合'
  return {
    title: `「${hint.promptText}」と聞かれたとき、御社がすすめられていません`,
    now: (
      <>
        AI は{joinNames(hint.competitorNames)}をすすめていて、御社の名前は
        {hint.brandRate === 0 ? (
          'まったく出てきません'
        ) : (
          <>
            {' '}
            <Num>{percent(hint.brandRate)}</Num> の回答にしか出てきません
          </>
        )}
        （{top}は <Num>{percent(hint.competitorRate)}</Num>）。
      </>
    ),
    why: 'この聞き方で調べている人には、御社が候補として見えていない状態です。',
    todo: 'このテーマを扱うページ（選び方の解説や、よくある質問など）を、御社のサイトに用意しましょう。',
    evidenceLabel: 'この質問への AI の回答を見る',
  }
}

function negativeText(hint: NegativeHint): HintText {
  return {
    title: 'AI が御社について、気になる書き方をしています',
    now: (
      <>
        御社の名前が出た回答のうち <Num>{hint.negativeResponses} 件</Num>
        で、AI は次のように書いています。
        {hint.quotes.length > 0 && (
          <span className="mt-2 flex flex-col gap-1">
            {hint.quotes.map((quote) => (
              <q
                key={quote}
                className="block border-l-4 border-danger/60 bg-paper px-3 py-1 before:content-none after:content-none"
              >
                {quote}
              </q>
            ))}
          </span>
        )}
      </>
    ),
    why: 'AI の書き方は、そのまま読んだ人の印象になります。',
    todo: 'もとになっていそうな口コミや記事を確かめましょう。事実と違うなら訂正をお願いし、当たっているなら、改善したことを御社のサイトで伝えましょう。',
    evidenceLabel: 'この書き方をした回答を見る',
  }
}

function ownSiteText(hint: OwnSiteHint, brandId: string): HintText {
  const why =
    'AI は、参考にしたサイトの内容をもとに答えます。御社のサイトが参考にされると、御社のことが正しく伝わりやすくなります。'
  if (hint.domain === null) {
    return {
      title: '御社のサイトのアドレスを登録してください',
      now: '御社のサイトが登録されていないため、AI が御社のサイトを参考にしているかどうかが分かりません。',
      why,
      todo: (
        <>
          <Link href={`/app/brands/${brandId}/settings`} className="underline underline-offset-4">
            設定
          </Link>
          の「自社サイトのドメイン」に、御社のサイトのアドレスを入れてください。
        </>
      ),
      evidenceLabel: 'AI が参考にしたサイトを見る',
    }
  }
  return {
    title: '御社のサイトが、AI にほとんど参考にされていません',
    now: (
      <>
        AI が参考にしたサイトのうち、{hint.domain} が入っていた回答は{' '}
        <Num>{percent(hint.ownRate)}</Num> です（いちばん多い {hint.topDomain} は{' '}
        <Num>{percent(hint.topRate)}</Num>）。
      </>
    ),
    why,
    todo: '料金・特長・よくある質問など、AI が答えに使いやすい情報を、御社のサイトの分かりやすい場所に書きましょう。',
    evidenceLabel: 'AI が参考にしたサイトを見る',
  }
}

function textFor(hint: Hint, brandId: string): HintText {
  switch (hint.kind) {
    case 'site':
      return siteText(hint)
    case 'prompt':
      return promptText(hint)
    case 'negative':
      return negativeText(hint)
    case 'ownSite':
      return ownSiteText(hint, brandId)
  }
}

function EvidenceResponses(props: { ids: string[]; evidence: Map<string, EvidenceResponse> }) {
  const responses = props.ids.flatMap((id) => {
    const found = props.evidence.get(id)
    return found ? [found] : []
  })
  if (responses.length === 0)
    return <p className="px-4 py-3 text-sm text-ink-soft">回答がありません。</p>
  return (
    <ul className="divide-y divide-rule">
      {responses.map((r) => (
        <li key={r.id}>
          <ResponseItem
            response={r}
            label={`${r.run.scheduledFor ?? formatDate(r.run.createdAt)} ${PROVIDER_LABEL[r.provider]}`}
          />
        </li>
      ))}
    </ul>
  )
}

function EvidenceDomains({ domains }: { domains: DomainCount[] }) {
  return (
    <ol className="flex flex-col divide-y divide-rule px-4 text-sm">
      {domains.map((d) => (
        <li key={d.domain} className="flex items-center justify-between gap-3 py-2">
          <span className="truncate">
            {d.domain}
            {d.isOwn && (
              <span className="ml-2 rounded-sm bg-own-soft px-1.5 text-xs">自社サイト</span>
            )}
          </span>
          <span className="num shrink-0 text-ink-soft">{d.responses} 件の回答</span>
        </li>
      ))}
    </ol>
  )
}

/** 根拠の数（見出しに添える） */
function evidenceCount(hint: Hint): number {
  return hint.kind === 'ownSite' ? hint.evidenceDomains.length : hint.evidenceResponseIds.length
}

export function HintCard({ hint, order, brandId, evidence }: HintCardProps) {
  const text = textFor(hint, brandId)
  const headingId = `hint-${order}`
  return (
    <article className="panel flex flex-col gap-4 p-5" aria-labelledby={headingId}>
      <h3 id={headingId} className="flex gap-3 text-lg font-bold leading-snug">
        <span className="num shrink-0 text-ink-soft">{order}.</span>
        <span>{text.title}</span>
      </h3>
      <dl className="grid gap-3 text-[0.95rem] leading-relaxed md:grid-cols-[9rem_1fr]">
        <dt className="text-sm font-bold text-ink-soft">何が起きているか</dt>
        <dd>{text.now}</dd>
        <dt className="text-sm font-bold text-ink-soft">なぜ大事か</dt>
        <dd>{text.why}</dd>
        <dt className="text-sm font-bold text-ink-soft">何をすればいいか</dt>
        <dd className="font-bold">{text.todo}</dd>
      </dl>
      <details className="group rounded-[var(--radius-box)] border border-rule">
        <summary className="cursor-pointer list-none px-4 py-2 text-sm hover:bg-paper">
          <span
            className="mr-2 inline-block text-ink-soft transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            ›
          </span>
          {text.evidenceLabel}（<span className="num">{evidenceCount(hint)}</span> 件）
        </summary>
        <div className="border-t border-rule">
          {hint.kind === 'ownSite' ? (
            <EvidenceDomains domains={hint.evidenceDomains} />
          ) : (
            <EvidenceResponses ids={hint.evidenceResponseIds} evidence={evidence} />
          )}
        </div>
      </details>
    </article>
  )
}
