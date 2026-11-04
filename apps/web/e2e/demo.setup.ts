import { expect, test as setup } from '@playwright/test'
import { DEMO_STATE } from './paths'

setup('デモアカウントでログインしておく', async ({ page }) => {
  await page.goto('/login?demo=1')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page).toHaveURL(/\/app\/brands\//)
  await page.context().storageState({ path: DEMO_STATE })
})
