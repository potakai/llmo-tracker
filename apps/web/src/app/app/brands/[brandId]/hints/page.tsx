import Link from 'next/link'
import { type EvidenceResponse, HintCard } from '@/components/hint-card'
import { HINT_WINDOW_DAYS, type HintsResult, hintKey } from '@/lib/hints'
import { loadBrandForPage } from '@/server/brand-page'
import { getBrandHints } from '@/server/queries/hints'

/** 改善のヒント：直近の AI の回答から見えたことと、次に検討できることを優先度の高い順に出す */
export default async function HintsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { organizationId, brand, llmMode } = await loadBrandForPage((await params).brandId)
  const { windowDays, hints, evidence } = await getBrandHints(organizationId, brand, llmMode)
  const evidenceById = new Map<string, EvidenceResponse>(evidence.map((r) => [r.id, r]))

  return (
    <div className="flex flex-col gap-6">
      <section className="max-w-3xl">
        <h2 className="text-xl font-bold">改善のヒント</h2>
        <Summary hints={hints} windowDays={windowDays} brandId={brand.id} />
      </section>

      {hints.status === 'ready' && hints.hints.length > 0 && (
        <ol className="flex flex-col gap-4" aria-label="改善のヒント">
          {hints.hints.map((hint, i) => (
            <li key={hintKey(hint)}>
              <HintCard hint={hint} order={i + 1} brandId={brand.id} evidence={evidenceById} />
            </li>
          ))}
        </ol>
      )}

      <p className="max-w-3xl text-xs leading-relaxed text-ink-soft">
        ヒントは、AI の回答を決まったルールで数えて見つけたものです。AI
        の答えは日によって変わるので、ひとつの目安としてご覧ください。それぞれの「回答を見る」から、もとになった実際の回答を確かめられます。
      </p>
    </div>
  )
}

type WaitingResult = Extract<HintsResult, { status: 'waiting' }>

/** データが集まるまでの案内。日数を見積もれないときは、その理由と、どこを変えればよいかを出す */
function WaitingMessage({ hints, brandId }: { hints: WaitingResult; brandId: string }) {
  const settings = (
    <Link href={`/app/brands/${brandId}/settings`} className="underline underline-offset-4">
      設定
    </Link>
  )
  const { estimate } = hints
  switch (estimate.kind) {
    case 'days':
      return (
        <>
          データが集まるまでお待ちください（あと{' '}
          <span className="num font-bold">{estimate.daysLeft}</span> 日ほど）。
        </>
      )
    case 'unreachable':
      return (
        <>
          今の設定では、{HINT_WINDOW_DAYS}日で {hints.needed} 件に届きません（1 日あたり{' '}
          <span className="num font-bold">{estimate.responsesPerDay}</span> 件）。{settings}
          で、質問か「1 回の計測で同じ質問を聞く回数」を増やしてください。
        </>
      )
    case 'scheduleOff':
      return (
        <>
          毎日の自動計測がオフになっているため、自動では回答が増えません。計測結果のタブの「今すぐ計測」で、手動で増やせます。
        </>
      )
    case 'noActivePrompts':
      return <>計測している質問がないため、回答が増えません。{settings}で質問を追加してください。</>
  }
}

function Summary(props: { hints: HintsResult; windowDays: number; brandId: string }) {
  const { hints, windowDays } = props
  if (hints.status === 'waiting') {
    return (
      <p className="mt-2 text-lg leading-relaxed">
        <WaitingMessage hints={hints} brandId={props.brandId} />
        少ない回答で決めつけないように、直近{windowDays}日の AI の回答が {hints.needed}{' '}
        件以上あるときにヒントを出します（いまは {hints.responses} 件）。
      </p>
    )
  }
  if (hints.hints.length === 0) {
    return (
      <p className="mt-2 text-lg leading-relaxed">
        直近{windowDays}日の AI の回答では、とくに目立った点は見つかりませんでした。
      </p>
    )
  }
  return (
    <p className="mt-2 text-lg leading-relaxed">
      直近{windowDays}日の AI の回答 <span className="num">{hints.responses}</span>{' '}
      件で見えたことと、次に検討できることを、優先度の高い順に並べました。
    </p>
  )
}
