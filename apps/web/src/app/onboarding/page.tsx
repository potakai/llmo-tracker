import { brand } from '@llmo/db'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { Wordmark } from '@/components/wordmark'
import { db } from '@/lib/db'
import { getViewer } from '@/server/viewer'
import { OnboardingForm } from './onboarding-form'

export default async function OnboardingPage() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')

  if (viewer.organizationId) {
    const [existing] = await db
      .select({ id: brand.id })
      .from(brand)
      .where(eq(brand.organizationId, viewer.organizationId))
      .limit(1)
    if (existing) redirect('/app')
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Wordmark />
      <h1 className="mt-10 text-2xl font-bold">計測を始める準備</h1>
      <p className="mt-2 text-ink-soft">
        自社と競合、そしてお客さんが AI にしそうな質問を登録します。あとからいつでも変えられます。
      </p>
      <OnboardingForm hasOrganization={viewer.organizationId !== null} />
    </div>
  )
}
