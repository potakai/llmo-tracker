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

  await page.getByLabel('ブランド名', { exact: true }).fill('E2E会計')
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

  // 改善のヒントは、回答が集まるまで待つ（1 日 20 件なので、あと 30 件は 2 日ほど）
  await page.getByRole('link', { name: '改善のヒント' }).click()
  await expect(page.getByText(/データが集まるまでお待ちください（あと 2 日ほど）/)).toBeVisible()
  await expect(page.getByText(/いまは 20 件/)).toBeVisible()
  await page.getByRole('link', { name: '計測結果' }).click()

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

    // ブランドの切り替えは見られるが、追加はできない
    await page.locator('summary', { hasText: 'ブランドを切り替える' }).click()
    await expect(page.getByRole('list', { name: 'ブランドの一覧' })).toBeVisible()
    await expect(page.getByRole('link', { name: '＋ ブランドを追加' })).toHaveCount(0)
    await page.goto('/app/brands/new')
    await expect(page.getByText('デモアカウントでは、ブランドを追加できません。')).toBeVisible()
  })

  test('「改善のヒント」タブで、4 種類の施策と、その根拠が見られる', async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('link', { name: '改善のヒント' }).click()
    await expect(page).toHaveURL(/\/hints$/)
    await expect(page.getByRole('link', { name: '改善のヒント' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByText(/次に検討できることを、優先度の高い順に並べました/)).toBeVisible()

    const hints = page.getByRole('list', { name: '改善のヒント' }).getByRole('article')
    await expect(hints).toHaveCount(5)
    // デモデータでは 4 種類すべてが出る
    await expect(
      page.getByRole('heading', { name: /が、競合の名前が出た回答でよく参考元になっています/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /への回答に、御社の名前が/ }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /否定的と判定された回答があります/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /参考元として表示される回答が少なめです/ }),
    ).toBeVisible()
    // 「すすめられた」「すすめられていない」とは書かない（数えているのは名前が出たかどうか。
    // 質問文そのものに「おすすめ」が入ることはあるので、言い回しで確かめる）
    await expect(hints.getByText(/すすめられ/)).toHaveCount(0)
    // 否定的な箇所を、前後の文とあわせて見せる
    const negative = hints.filter({ hasText: '否定的と判定された回答があります' })
    await expect(
      negative.getByText('サンプル会計：サポートの返信が遅いという声もあります。', { exact: true }),
    ).toBeVisible()
    // 抜き出した箇所は「確認の手がかり」と明示し、判断は回答全体を見るように案内する
    await expect(negative.getByText(/^確認の手がかり/)).toBeVisible()
    await expect(
      negative.getByText(/件は、確認の手がかりになる箇所を自動では抜き出せませんでした/),
    ).toBeVisible()
    await expect(
      negative.getByText(/最終的な判断は、下の「回答を見る」から回答全体を見て行ってください/),
    ).toBeVisible()
    // 質問のカードは、今回の計測で名前が出た割合を比べた事実として書く
    await expect(
      hints
        .getByText(/この質問への今回の計測の回答では、御社の名前が出た割合は.+より低めでした/)
        .first(),
    ).toBeVisible()
    // サイトのカードも、今回の計測で観測したこととして書く
    await expect(
      hints.getByText(
        '今回の計測では、このサイトが競合の名前と同じ回答に参考元として表示されました。',
      ),
    ).toBeVisible()
    // 自社サイトのカードで比べる相手は、御社以外のサイト
    await expect(hints.getByText(/（御社以外でいちばん多かった .+ は \d+%）/)).toBeVisible()
    // 自社サイトのカードは「参考元として表示された」という観測だけを書く
    await expect(
      hints.getByText('今回の計測では、参考元として表示されたのは、主に御社以外のサイトでした。'),
    ).toBeVisible()
    // 自社サイトの割合は、何のうちの割合かを書く
    await expect(hints.getByText(/今回の計測で参考元が表示された回答 \d+ 件のうち/)).toBeVisible()

    // 根拠を開くと、実際の AI の回答が見られる
    const site = hints.filter({ hasText: 'よく参考元になっています' })
    await site.getByText(/が参考元になった回答を見る/).click()
    const firstAnswer = site.locator('details details').first()
    await firstAnswer.locator('summary').click()
    await expect(firstAnswer.getByText('会計ソフトランキング')).toBeVisible()

    // 自社サイトの施策の根拠は、参考元として表示されたサイトの一覧
    const own = hints.filter({ hasText: '参考元として表示される回答が少なめです' })
    await own.getByText('参考元として表示されたサイトを見る').click()
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
  await page.getByLabel('ブランド名', { exact: true }).fill('設定会計')
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

  // 改善のヒント：今の設定では 14 日で 50 件に届かないなら、そう伝える
  // （質問 2 つ × ChatGPT だけ × 1 回 = 1 日 2 件）
  await page.getByLabel('1 回の計測で同じ質問を聞く回数').selectOption('1')
  await page.getByRole('checkbox', { name: 'Gemini' }).uncheck()
  await page.getByRole('button', { name: '設定を保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await page.getByRole('link', { name: '改善のヒント' }).click()
  await expect(
    page.getByText(/今の設定では、14日で 50 件に届きません（1 日あたり 2 件）/),
  ).toBeVisible()

  // 自動計測をオフにすると、日数ではなく、オフになっていることを伝える
  // （案内の文の中にも「設定」へのリンクがあるので、タブから開く）
  await page
    .getByRole('navigation', { name: 'ブランドの画面' })
    .getByRole('link', { name: '設定' })
    .click()
  await page.getByRole('checkbox', { name: '毎日自動で計測する' }).uncheck()
  await page.getByRole('button', { name: '設定を保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await page.getByRole('link', { name: '改善のヒント' }).click()
  await expect(
    page.getByText(/自動では回答が増えません。.*「今すぐ計測」で、手動で増やせます/),
  ).toBeVisible()
})

test('ブランドを追加して、ヘッダーから切り替えられる。/app では最後に見たブランドが開く', async ({
  page,
  browser,
}) => {
  await page.goto('/signup')
  await page.getByLabel('お名前').fill('代理店テスト')
  await page.getByLabel('メールアドレス').fill(`agency-${Date.now()}@example.com`)
  await page.getByLabel(/パスワード/).fill('password-1234')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByLabel(/組織の名前/).fill('代理店株式会社')
  await page.getByRole('button', { name: '次へ' }).click()
  await page.getByLabel('ブランド名', { exact: true }).fill('クライアントA')
  await page.getByLabel(/AI に聞く質問/).fill('おすすめの会計ソフトは？')
  await page.getByRole('button', { name: '登録して計測画面へ' }).click()
  await expect(page.getByRole('heading', { name: 'クライアントA' })).toBeVisible()

  // ヘッダーのブランド名から「ブランドを追加」へ
  const switcher = page.locator('summary', { hasText: 'ブランドを切り替える' })
  await switcher.click()
  await page.getByRole('link', { name: '＋ ブランドを追加' }).click()
  await expect(page).toHaveURL(/\/app\/brands\/new$/)
  await page.getByLabel('ブランド名', { exact: true }).fill('クライアントB')
  await page.getByLabel(/別の呼び方/).fill('Client B')
  await page.getByLabel(/AI に聞く質問/).fill('おすすめの経費精算アプリは？')
  await page.getByLabel(/検索キーワード/).fill('経費精算 比較')
  await page.getByRole('button', { name: '追加して計測画面へ' }).click()
  await expect(page.getByRole('heading', { name: 'クライアントB' })).toBeVisible()

  // 入力した質問とキーワードが、種類つきで登録されている
  await page.getByRole('link', { name: '設定' }).click()
  await expect(page.getByLabel('「経費精算 比較」の種類')).toHaveValue('keyword')
  await expect(page.getByLabel('「おすすめの経費精算アプリは？」の種類')).toHaveValue('question')

  // ヘッダーから 1 社目に切り替える（画面の中の移動）
  await switcher.click()
  await page
    .getByRole('list', { name: 'ブランドの一覧' })
    .getByRole('link', { name: 'クライアントA' })
    .click()
  await expect(page.getByRole('heading', { name: 'クライアントA' })).toBeVisible()

  // /app に来ると、最後に見たブランドが開く
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'クライアントA' })).toBeVisible()

  // 素早く A → B → C と開くと、最後に開いた C が残る
  const created = await page.request.post('/api/brands', {
    data: { name: 'クライアントC', prompts: ['おすすめの勤怠管理アプリは？'] },
  })
  expect(created.status()).toBe(201)
  const brandC = ((await created.json()) as { brand: { id: string } }).brand.id
  const brandIds = await page.evaluate(() =>
    [...document.querySelectorAll('ul[aria-label="ブランドの一覧"] a')].map(
      (a) => a.getAttribute('href') ?? '',
    ),
  )
  const [hrefA, hrefB] = brandIds
  await page.goto(hrefA!, { waitUntil: 'commit' })
  await page.goto(hrefB!, { waitUntil: 'commit' })
  await page.goto(`/app/brands/${brandC}`, { waitUntil: 'commit' })
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'クライアントC' })).toBeVisible()

  // 他の組織（デモ）のブランド ID が Cookie にあっても、/app では最初に登録したブランドが開く
  // （本番モードではサインアップにも回数の制限があるので、新しくアカウントを作らずにこのテストの中で確かめる）
  const demoContext = await browser.newContext({ storageState: DEMO_STATE })
  const demoPage = await demoContext.newPage()
  await demoPage.goto('/app')
  await expect(demoPage).toHaveURL(/\/app\/brands\//)
  const demoBrandId = new URL(demoPage.url()).pathname.split('/')[3]
  await demoContext.close()

  // 他の組織のブランドの画面は 404。ただし、開いたブランドとして Cookie には書かれる
  const res = await page.goto(`/app/brands/${demoBrandId}`)
  expect(res?.status()).toBe(404)
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'llmo_current_brand')?.value).toBe(demoBrandId)

  // /app では Cookie のブランドを組織の中で確かめて、最初に登録したブランドを開く
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'クライアントA' })).toBeVisible()
})
