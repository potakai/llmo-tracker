import { expect, test } from '@playwright/test'

test('デモアカウントでログインすると、30日分のダッシュボードが見られる', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'デモアカウントで見る' }).click()
  await expect(page).toHaveURL(/\/login\?demo=1/)
  await page.getByRole('button', { name: 'ログイン' }).click()

  await expect(page).toHaveURL(/\/app\/brands\//)
  await expect(page.getByRole('heading', { name: 'サンプル会計' })).toBeVisible()
  await expect(page.getByText(/直近7日、AI の回答/)).toBeVisible()

  // 実行の詳細で、回答の中身が見られる
  await page.getByRole('link', { name: '回答を見る' }).first().click()
  await expect(page.getByText('中小企業向けのおすすめ会計ソフトは？').first()).toBeVisible()
})

test('間違ったパスワードでは、ログインできないことが伝わる', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('メールアドレス').fill('demo@llmo-tracker.example')
  await page.getByLabel('パスワード').fill('wrong-password')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByText('メールアドレスかパスワードが違います')).toBeVisible()
})

test('新規登録 → 組織 → ブランド登録 → 計測 まで通る', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('お名前').fill('テスト太郎')
  await page.getByLabel('メールアドレス').fill(`e2e-${Date.now()}@example.com`)
  await page.getByLabel(/パスワード/).fill('password-1234')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()

  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel(/組織の名前/).fill('E2E 株式会社')
  await page.getByRole('button', { name: '次へ' }).click()

  await page.getByLabel('自社のブランド名').fill('E2E会計')
  await page.getByLabel(/競合/).fill('ミライ会計\nラクラク帳簿')
  // 11 個はエラーになる
  await page
    .getByLabel(/AI に聞く質問/)
    .fill(Array.from({ length: 11 }, (_, i) => `質問${i}`).join('\n'))
  await page.getByRole('button', { name: '登録して計測画面へ' }).click()
  await expect(page.getByText('質問は10件までです')).toBeVisible()

  await page.getByLabel(/AI に聞く質問/).fill('おすすめの会計ソフトは？\n安い会計ソフトは？')
  await page.getByRole('button', { name: '登録して計測画面へ' }).click()
  await expect(page).toHaveURL(/\/app\/brands\//)
  await expect(page.getByText('まだ計測した回答がありません')).toBeVisible()

  await page.getByRole('button', { name: '今すぐ計測' }).click()
  await expect(page.getByRole('cell', { name: '完了' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/直近7日、AI の回答 20 件のうち/)).toBeVisible()
})
