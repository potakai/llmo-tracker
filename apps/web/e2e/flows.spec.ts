import { expect, test } from '@playwright/test'
import { DEMO_STATE } from './paths'

test('デモアカウントでログインすると、30日分のダッシュボードが見られる', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'デモアカウントで見る' }).click()
  await expect(page).toHaveURL(/\/login\?demo=1/)
  await page.getByRole('button', { name: 'ログイン' }).click()

  await expect(page).toHaveURL(/\/app\/brands\//)
  await expect(page.getByRole('heading', { name: 'サンプル会計' })).toBeVisible()
  await expect(page.getByText(/直近7日、AI の回答/)).toBeVisible()
  // デモにはデモの案内だけを出す（サンプルの AI の案内は出さない）
  await expect(page.getByText(/サンプルの AI/)).toHaveCount(0)

  // 聞き方（質問文・キーワード）ごとの言及率を比べられ、種類で絞り込める
  await expect(page.getByText(/聞き方別では、/)).toBeVisible()
  await page.getByRole('link', { name: 'キーワード', exact: true }).click()
  await expect(page).toHaveURL(/kind=keyword/)
  await expect(page.getByText(/直近7日、キーワードの質問の回答/)).toBeVisible()
  // 質問を 1 つ選ぶと、比べるものがないので比較は出さない
  await page.getByRole('combobox', { name: /質問/ }).selectOption({ index: 1 })
  await expect(page).toHaveURL(/q=/)
  await expect(page.getByText(/聞き方別では、/)).toHaveCount(0)

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
  await expect(page.getByText(/まだ計測していません。「今すぐ計測」を押すと/)).toBeVisible()
  // オンボーディングでスクロールしていても、ブランドの画面は一番上から表示される
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  // 本物の AI を許可していない組織なので、フェイクで計測することが伝わる
  await expect(page.getByText(/この組織の計測はサンプルの AI/)).toBeVisible()
  await expect(page.getByText(/この組織の計測はサンプルの AI/)).toBeInViewport()

  await page.getByRole('button', { name: '今すぐ計測' }).click()
  await expect(page.getByRole('cell', { name: '完了' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/直近7日、AI の回答 20 件のうち/)).toBeVisible()

  // キーワードの質問はまだないが、絞り込んでも種類ごとの比較は出る
  await page.getByRole('link', { name: 'キーワード', exact: true }).click()
  await expect(page).toHaveURL(/kind=keyword/)
  await expect(page.getByText(/この条件では、直近7日の回答がありません/)).toBeVisible()
  await expect(
    page.getByText(/聞き方別では、質問文 \d+%（回答 20 件）\s*／ キーワード —（回答 0 件）/),
  ).toBeVisible()
})

test.describe('デモアカウントでログイン済み', () => {
  // ログインは試行回数の制限（10 秒に 3 回）があるので、ログイン済みの状態を使い回す
  test.use({ storageState: DEMO_STATE })

  test('デモは閲覧専用：計測ボタンは押せず、設定も変えられない', async ({ page }) => {
    await page.goto('/app')
    await expect(page.getByText('デモアカウントで見ています')).toBeVisible()
    await expect(page.getByRole('button', { name: '今すぐ計測' })).toBeDisabled()
    await expect(page.getByText('デモでは計測できません')).toBeVisible()

    await page.getByRole('link', { name: '設定' }).click()
    await expect(page.getByRole('button', { name: '質問を追加' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '設定を保存' })).toBeDisabled()
  })

  test('「改善のヒント」タブで、4 種類の施策と、その根拠が見られる', async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('link', { name: '改善のヒント' }).click()
    await expect(page).toHaveURL(/\/hints$/)
    await expect(page.getByRole('link', { name: '改善のヒント' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByText(/次にやるとよいことを、大事な順に並べました/)).toBeVisible()

    const hints = page.getByRole('list', { name: '改善のヒント' }).getByRole('article')
    await expect(hints).toHaveCount(5)
    // デモデータでは 4 種類すべてが出る
    await expect(page.getByRole('heading', { name: /御社の情報を載せましょう/ })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /御社がすすめられていません/ }).first(),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: /気になる書き方をしています/ })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /AI にほとんど参考にされていません/ }),
    ).toBeVisible()
    // AI が自社について書いた文を、そのまま見せる
    await expect(
      page.getByText('サンプル会計：サポートの返信が遅いという声もあります。', { exact: true }),
    ).toBeVisible()

    // 根拠を開くと、実際の AI の回答が見られる
    const site = hints.filter({ hasText: '御社の情報を載せましょう' })
    await site.getByText(/を参考にした回答を見る/).click()
    const firstAnswer = site.locator('details details').first()
    await firstAnswer.locator('summary').click()
    await expect(firstAnswer.getByText('会計ソフトランキング')).toBeVisible()

    // 自社サイトの施策の根拠は、参考にされたサイトの一覧
    const own = hints.filter({ hasText: 'AI にほとんど参考にされていません' })
    await own.getByText('AI が参考にしたサイトを見る').click()
    await expect(own.getByText('自社サイト')).toBeVisible()
  })

  test('絞り込みは URL に残り、そのまま開き直しても同じ画面になる', async ({ page }) => {
    await page.goto('/app')
    await expect(page).toHaveURL(/\/app\/brands\//)

    await page.getByRole('link', { name: 'Gemini', exact: true }).click()
    await expect(page).toHaveURL(/ai=gemini/)
    await page.getByRole('link', { name: '90日' }).click()
    await expect(page).toHaveURL(/days=90/)
    await expect(page.getByText(/直近7日、Geminiの回答/)).toBeVisible()

    // URL を直接開いても同じ状態
    await page.goto(page.url())
    await expect(page.getByRole('link', { name: 'Gemini', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    )

    // 質問ごとの結果から、質問の詳細へ（絞り込みは引き継ぐ）
    await page.goto(page.url().replace('ai=gemini', ''))
    await page.getByRole('table').getByRole('link').first().click()
    await expect(page).toHaveURL(/\/prompts\/.+days=90/)
    await expect(page.getByRole('heading', { name: /この質問での言及率の推移/ })).toBeVisible()
  })
})

test('設定で質問と競合を編集できる', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/signup')
  await page.getByLabel('お名前').fill('設定テスト')
  await page.getByLabel('メールアドレス').fill(`settings-${Date.now()}@example.com`)
  await page.getByLabel(/パスワード/).fill('password-1234')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByLabel(/組織の名前/).fill('設定テスト株式会社')
  await page.getByRole('button', { name: '次へ' }).click()
  await page.getByLabel('自社のブランド名').fill('設定会計')
  await page.getByLabel(/競合/).fill('競合A')
  await page.getByLabel(/AI に聞く質問/).fill('質問その1')
  await page.getByRole('button', { name: '登録して計測画面へ' }).click()
  await expect(page).toHaveURL(/\/app\/brands\//)

  await page.getByRole('link', { name: '設定' }).click()

  // 質問を追加して、元の質問をアーカイブ
  await page.getByLabel('追加する質問', { exact: true }).fill('質問その2')
  await page.getByRole('button', { name: '質問を追加' }).click()
  await expect(page.getByText('2 / 10 個')).toBeVisible()
  await page
    .getByRole('listitem')
    .filter({ hasText: '質問その1' })
    .getByRole('button', { name: 'アーカイブ' })
    .click()
  await expect(page.getByText('1 / 10 個')).toBeVisible()
  await expect(page.getByText('アーカイブした質問（1 個）')).toBeVisible()

  // 同じ質問は追加できない
  await page.getByLabel('追加する質問', { exact: true }).fill('質問その2')
  await page.getByRole('button', { name: '質問を追加' }).click()
  await expect(page.getByText('同じ質問がすでにあります')).toBeVisible()

  // キーワードの質問を追加し、既存の質問の種類も変える
  await page.getByLabel('追加する質問の種類').selectOption('keyword')
  await page.getByLabel('追加する質問', { exact: true }).fill('会計ソフト 比較')
  await page.getByRole('button', { name: '質問を追加' }).click()
  await expect(page.getByText('2 / 10 個')).toBeVisible()
  await expect(page.getByLabel('「会計ソフト 比較」の種類')).toHaveValue('keyword')
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && /\/prompts\//.test(res.url()),
  )
  await page.getByLabel('「質問その2」の種類').selectOption('keyword')
  expect((await saved).status()).toBe(200)
  await page.reload()
  await expect(page.getByLabel('「質問その2」の種類')).toHaveValue('keyword')

  // 競合の名前を変えて、削除する
  await page.getByRole('button', { name: '名前を変える' }).click()
  await page.getByLabel('競合A の新しい名前').fill('競合A（新社名）')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('競合A（新社名）')).toBeVisible()
  await page.getByRole('button', { name: '削除' }).click()
  await expect(page.getByText('競合はまだ登録されていません。')).toBeVisible()

  // ブランドの設定
  await page.getByLabel('1 回の計測で同じ質問を聞く回数').selectOption('3')
  await page.getByRole('button', { name: '設定を保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('1 回の計測で同じ質問を聞く回数')).toHaveValue('3')
})
