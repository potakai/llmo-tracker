import Link from 'next/link'
import { BrandForm } from '@/components/brand-form'
import { getLlmPolicy } from '@/lib/llm'
import { perAnswerCostUsd } from '@/server/cost-estimate'
import { isDemoOrganization } from '@/server/demo'
import { requireViewerWithOrg } from '@/server/viewer'

/** 2 社目以降のブランドを追加する。入力は初期設定と同じフォーム */
export default async function NewBrandPage() {
  const { organizationId } = await requireViewerWithOrg()
  const isDemo = await isDemoOrganization(organizationId)
  const isLive = getLlmPolicy().modeFor(organizationId) === 'live'

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">ブランドを追加</h1>
        <p className="mt-2 text-ink-soft">
          計測するブランドを増やします。ヘッダーのブランド名から、いつでも切り替えられます。
        </p>
      </div>
      {isDemo ? (
        <p className="rounded-[var(--radius-box)] bg-own-soft px-4 py-3 text-sm">
          デモアカウントでは、ブランドを追加できません。
          <Link href="/app" className="ml-1 underline">
            ブランドの画面に戻る
          </Link>
        </p>
      ) : (
        <BrandForm
          submitLabel="追加して計測画面へ"
          perAnswerUsd={isLive ? perAnswerCostUsd() : undefined}
        />
      )}
    </div>
  )
}
