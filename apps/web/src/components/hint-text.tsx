/**
 * 改善のヒントの文章。読むのはクライアント本人なので、専門用語を避ける。
 * - 数えているのは「名前が出たか」「参考元に表示されたか」なので、観測した事実として書く（「すすめられた」とは書かない）
 * - 次の行動は「検討できること」として書き、効果は断定しない
 * - 割合には、何のうちの割合か（母数）を添える
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import type {
  Hint,
  NegativeHint,
  OwnSiteHint,
  OwnSiteSetupHint,
  PromptHint,
  SiteHint,
} from '@/lib/hints'
import { percent } from './labels'

/** 施策 1 つ分の文章。「何が起きているか → なぜ大事か → 次にできること」の順に出す */
export type HintText = {
  title: string
  now: ReactNode
  why: string
  next: ReactNode
  evidenceLabel: string
}

/** 「ミライ会計やラクラク帳簿」 */
const joinNames = (names: string[]) => (names.length > 0 ? names.join('や') : '競合')

export const Num = ({ children }: { children: ReactNode }) => (
  <span className="num font-bold">{children}</span>
)

const settingsLink = (brandId: string) => (
  <Link href={`/app/brands/${brandId}/settings`} className="underline underline-offset-4">
    設定
  </Link>
)

function siteText(hint: SiteHint): HintText {
  return {
    title: `${hint.domain} が、競合の名前が出た回答でよく参考元になっています`,
    now: (
      <>
        今回の計測では、競合の名前が出た回答のうち <Num>{percent(hint.competitorRate)}</Num> で、
        {hint.domain} が参考元として表示されました（一緒によく名前が出たのは
        {joinNames(hint.competitorNames)}）。
        {hint.brandRate === null ? (
          <>
            御社の名前が出た回答はまだ <Num>{hint.brandResponses} 件</Num>
            と少ないため、御社の側とは比べていません。
          </>
        ) : (
          <>
            御社の名前が出た回答では <Num>{percent(hint.brandRate)}</Num> でした。
          </>
        )}
      </>
    ),
    why: 'AI がこの分野の会社の名前を挙げるときに、参考にしているサイトのひとつです。',
    next: `${hint.domain} に御社の情報を載せてもらえないか、問い合わせることを検討できます。載ったあとに御社の名前が出る回答が増えたかどうかは、この画面で確かめられます。`,
    evidenceLabel: `${hint.domain} が参考元になった回答を見る`,
  }
}

function promptText(hint: PromptHint): HintText {
  const top = hint.competitorNames[0] ?? '競合'
  return {
    title:
      hint.brandRate === 0
        ? `「${hint.promptText}」への回答に、御社の名前が出ていません`
        : `「${hint.promptText}」への回答に、御社の名前が出ることが少なめです`,
    now: (
      <>
        今回の計測では、この質問への回答のうち、{top}の名前は{' '}
        <Num>{percent(hint.competitorRate)}</Num>、御社の名前は <Num>{percent(hint.brandRate)}</Num>{' '}
        で出ました。
      </>
    ),
    why: 'この聞き方で調べた人が目にする回答に、御社の名前が入っていないことが多い状態です。',
    next: 'このテーマを扱うページ（選び方の解説や、よくある質問など）を、御社のサイトに用意することを検討できます。',
    evidenceLabel: 'この質問への回答を見る',
  }
}

const OPEN_WHOLE_ANSWER = '下の「回答を見る」から、回答全体を確かめてください。'

function NegativePassages({ hint }: { hint: NegativeHint }) {
  return (
    <span className="mt-2 flex flex-col gap-2">
      {hint.passages.map((p) => (
        <span key={p.focus} className="block border-l-4 border-danger/60 bg-paper px-3 py-2">
          {p.before && <span className="block text-sm text-ink-soft">{p.before}</span>}
          <mark className="block bg-transparent font-bold text-ink">{p.focus}</mark>
          {p.after && <span className="block text-sm text-ink-soft">{p.after}</span>}
        </span>
      ))}
    </span>
  )
}

function negativeText(hint: NegativeHint): HintText {
  const unlocated =
    hint.passages.length === 0
      ? `どこが否定的かは、自動では特定できませんでした。${OPEN_WHOLE_ANSWER}`
      : hint.unlocatedResponses > 0
        ? `ほかの ${hint.unlocatedResponses} 件は、どこが否定的かを自動では特定できませんでした。${OPEN_WHOLE_ANSWER}`
        : null
  return {
    title: 'AI が御社について、否定的に書いている回答があります',
    now: (
      <>
        今回の計測では、御社の名前が出た回答のうち <Num>{hint.negativeResponses} 件</Num>
        が、否定的な書き方と判定されました。
        {hint.passages.length > 0 && <NegativePassages hint={hint} />}
        {unlocated && <span className="mt-2 block">{unlocated}</span>}
      </>
    ),
    why: 'AI の書き方は、そのまま読んだ人の印象につながります。',
    next: 'もとになっていそうな口コミや記事を確かめることを検討できます。事実と違えば訂正をお願いし、当たっていれば、改善した内容を御社のサイトで伝える方法があります。',
    evidenceLabel: '否定的と判定された回答を見る',
  }
}

function ownSiteText(hint: OwnSiteHint): HintText {
  return {
    title: '御社のサイトが参考元として表示される回答が少なめです',
    now: (
      <>
        今回の計測で参考元が表示された回答 <Num>{hint.responses} 件</Num>のうち、{hint.domain}{' '}
        が含まれていたのは <Num>{percent(hint.ownRate)}</Num> でした（いちばん多かった{' '}
        {hint.topDomain} は {percent(hint.topRate)}）。
      </>
    ),
    why: 'AI は、参考元のサイトの内容をもとに回答を書いています。',
    next: '料金・特長・よくある質問など、回答に使われやすい情報を、御社のサイトの分かりやすい場所に書くことを検討できます。',
    evidenceLabel: '参考元として表示されたサイトを見る',
  }
}

function ownSiteSetupText(_hint: OwnSiteSetupHint, brandId: string): HintText {
  return {
    title: '御社のサイトのアドレスを登録してください',
    now: '御社のサイトが登録されていないため、AI の回答で御社のサイトが参考元として表示されたかどうかを数えられません。',
    why: '登録すると、御社のサイトが参考元になった割合を、ほかのサイトと比べられるようになります。',
    next: (
      <>
        {settingsLink(brandId)}
        の「自社サイトのドメイン」に、御社のサイトのアドレスを入れてください。
      </>
    ),
    evidenceLabel: '参考元として表示されたサイトを見る',
  }
}

export function textFor(hint: Hint, brandId: string): HintText {
  switch (hint.kind) {
    case 'site':
      return siteText(hint)
    case 'prompt':
      return promptText(hint)
    case 'negative':
      return negativeText(hint)
    case 'ownSite':
      return ownSiteText(hint)
    case 'ownSiteSetup':
      return ownSiteSetupText(hint, brandId)
  }
}
