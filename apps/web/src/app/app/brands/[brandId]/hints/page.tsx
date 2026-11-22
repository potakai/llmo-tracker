import { type EvidenceResponse, HintCard } from '@/components/hint-card'
import { type HintsResult, hintKey } from '@/lib/hints'
import { loadBrandForPage } from '@/server/brand-page'
import { getBrandHints } from '@/server/queries/hints'

/** 改善のヒント：直近の AI の回答から、次にやるとよいことを大事な順に出す */
export default async function HintsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { organizationId, brand, llmMode } = await loadBrandForPage((await params).brandId)
  const { windowDays, hints, evidence } = await getBrandHints(organizationId, brand, llmMode)
  const evidenceById = new Map<string, EvidenceResponse>(evidence.map((r) => [r.id, r]))

  return (
    <div className="flex flex-col gap-6">
      <section className="max-w-3xl">
        <h2 className="text-xl font-bold">改善のヒント</h2>
        <Summary hints={hints} windowDays={windowDays} />
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

function Summary({ hints, windowDays }: { hints: HintsResult; windowDays: number }) {
  if (hints.status === 'waiting') {
    return (
      <p className="mt-2 text-lg leading-relaxed">
        データが集まるまでお待ちください
        {hints.daysLeft !== null && (
          <>
            （あと <span className="num font-bold">{hints.daysLeft}</span> 日ほど）
          </>
        )}
        。少ない回答で決めつけないように、AI の回答が {hints.needed}{' '}
        件集まってからヒントを出します（いまは {hints.responses} 件）。
        {hints.daysLeft === null && '毎日の自動計測がオフになっているので、計測すると集まります。'}
      </p>
    )
  }
  if (hints.hints.length === 0) {
    return (
      <p className="mt-2 text-lg leading-relaxed">
        直近{windowDays}日の AI の回答では、とくに手を打つべきところは見つかりませんでした。
      </p>
    )
  }
  return (
    <p className="mt-2 text-lg leading-relaxed">
      直近{windowDays}日の AI の回答 <span className="num">{hints.responses}</span>{' '}
      件から、次にやるとよいことを、大事な順に並べました。
    </p>
  )
}
