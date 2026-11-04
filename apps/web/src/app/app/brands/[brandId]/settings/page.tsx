import { prompt } from '@llmo/db'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { loadBrandForPage } from '@/server/brand-page'
import { MAX_ACTIVE_PROMPTS, MAX_COMPETITORS } from '@/server/schemas/brand'
import { BrandInfoForm } from './brand-info-form'
import { CompetitorsEditor } from './competitors-editor'
import { PromptsEditor } from './prompts-editor'

export default async function SettingsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brand, isDemo } = await loadBrandForPage((await params).brandId)
  // 設定ではアーカイブした質問も見せる（元に戻せるように）
  const prompts = await db
    .select({ id: prompt.id, text: prompt.text, archivedAt: prompt.archivedAt })
    .from(prompt)
    .where(eq(prompt.brandId, brand.id))
    .orderBy(asc(prompt.createdAt))

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PromptsEditor
        brandId={brand.id}
        readOnly={isDemo}
        max={MAX_ACTIVE_PROMPTS}
        prompts={prompts.map((p) => ({ ...p, archived: p.archivedAt !== null }))}
      />
      <CompetitorsEditor
        brandId={brand.id}
        readOnly={isDemo}
        max={MAX_COMPETITORS}
        competitors={brand.competitors.map((c) => ({ id: c.id, name: c.name }))}
      />
      <BrandInfoForm
        readOnly={isDemo}
        brand={{
          id: brand.id,
          name: brand.name,
          aliases: brand.aliases,
          domain: brand.domain,
          samplesPerPrompt: brand.samplesPerPrompt,
          providers: brand.providers,
          scheduleEnabled: brand.scheduleEnabled,
        }}
      />
    </div>
  )
}
