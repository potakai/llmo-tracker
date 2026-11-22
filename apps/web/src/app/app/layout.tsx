import type { ReactNode } from 'react'
import { BrandSwitcher } from '@/components/brand-switcher'
import { SignOutButton } from '@/components/sign-out-button'
import { Wordmark } from '@/components/wordmark'
import { isDemoOrganization } from '@/server/demo'
import { listBrandsInOrganization } from '@/server/queries/brands'
import { requireViewerWithOrg } from '@/server/viewer'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewerWithOrg()
  const [brands, isDemo] = await Promise.all([
    listBrandsInOrganization(viewer.organizationId),
    isDemoOrganization(viewer.organizationId),
  ])
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Wordmark href="/app" />
            {brands.length > 0 && <BrandSwitcher brands={brands} canAddBrand={!isDemo} />}
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-ink-soft sm:inline">{viewer.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
