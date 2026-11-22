import {
  brand as brandTable,
  competitor,
  organization,
  prompt,
  serpAiOverviewReference,
  serpEntity,
  serpResult,
} from '@llmo/db'
import {
  createFakeSerpProvider,
  createSerpPolicy,
  type FetchedTask,
  type ParsedSerp,
  SerpApiError,
  type SerpMode,
  type SerpProvider,
} from '@llmo/serp'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  claimDailySerpTasks,
  claimSerpTasks,
  collectSerpResults,
  giveUpSerpTasks,
  postSerpTasks,
  recoverStaleSerpResults,
  type SerpDeps,
  waitAndCollectSerpResults,
} from '../src'
import { db, extractor, seedBrand } from './fixtures'

// テストどうしで日付がぶつからないように、テストごとに別の日を使う
let day = 0
const nextDate = () => `2031-02-${String(++day).padStart(2, '0')}`
const UNLIMITED = { budgetMs: Number.POSITIVE_INFINITY }
const allFake = () => 'fake' as const

/** 呼ばれた検索語を覚えておくプロバイダー。結果は fetch で決める（省略するとフェイクと同じ） */
function recordingProvider(
  mode: SerpMode,
  options: {
    post?: (keyword: string) => Promise<{ taskId: string; costUsd: number | null }>
    fetch?: (keyword: string, taskId: string) => Promise<FetchedTask>
  } = {},
) {
  const fake = createFakeSerpProvider()
  const posted: string[] = []
  const fetched: string[] = []
  const provider: SerpProvider = {
    mode,
    async postTask(input) {
      posted.push(input.keyword)
      return options.post ? options.post(input.keyword) : fake.postTask(input)
    },
    async fetchTask(input) {
      fetched.push(input.keyword)
      return options.fetch ? options.fetch(input.keyword, input.taskId) : fake.fetchTask(input)
    },
  }
  return { provider, posted, fetched }
}

/**
 * テスト用の依存。modeFor は「その組織が今、本物を使ってよいか」（省略するとすべての組織に許可がある）。
 * fake の行は、許可があってもフェイクのまま扱う
 */
function depsWith(
  providers: Partial<Record<SerpMode, SerpProvider>>,
  modeFor: (organizationId: string) => SerpMode = () => 'live',
): SerpDeps {
  return {
    db,
    serp: {
      modeFor,
      providerFor: (mode) => {
        const p = providers[mode]
        if (!p) throw new Error(`${mode} のプロバイダーは使わないはず`)
        return p
      },
    },
    extractorFor: () => extractor,
  }
}

async function rowsOf(promptIds: string[], date: string) {
  return db
    .select()
    .from(serpResult)
    .where(and(inArray(serpResult.promptId, promptIds), eq(serpResult.searchedOn, date)))
    .orderBy(asc(serpResult.createdAt))
}

const keywordIds = (prompts: { id: string; kind: string }[]) =>
  prompts.filter((p) => p.kind === 'keyword').map((p) => p.id)

/** そのテストだけの検索語（ほかのテストのブランドも同じ日に拾われるので、自分の分だけを数える） */
const uniqueKeyword = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`

describe('claimDailySerpTasks（その日に検索するキーワード）', () => {
  it('キーワードの質問だけを対象にし、2 回呼んでも 1 キーワード 1 日 1 行', async () => {
    const { prompts } = await seedBrand({ keywords: [uniqueKeyword('会計ソフト')] })
    const date = nextDate()

    await claimDailySerpTasks(db, date, allFake)
    await claimDailySerpTasks(db, date, allFake)

    const rows = await rowsOf(
      prompts.map((p) => p.id),
      date,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      promptId: keywordIds(prompts)[0],
      status: 'pending',
      mode: 'fake',
    })
  })

  it('自動計測がオフのブランド・デモ組織・アーカイブ済みの質問は対象外', async () => {
    const off = await seedBrand({ keywords: [uniqueKeyword('オフ')] })
    await db
      .update(brandTable)
      .set({ scheduleEnabled: false })
      .where(eq(brandTable.id, off.brand.id))
    const demo = await seedBrand({ keywords: [uniqueKeyword('デモ')] })
    await db
      .update(organization)
      .set({ metadata: JSON.stringify({ demo: true }) })
      .where(eq(organization.id, demo.brand.organizationId))
    const archived = await seedBrand({ keywords: [uniqueKeyword('アーカイブ')] })
    await db
      .update(prompt)
      .set({ archivedAt: new Date() })
      .where(inArray(prompt.id, keywordIds(archived.prompts)))
    const date = nextDate()

    await claimDailySerpTasks(db, date, allFake)

    const ids = [off, demo, archived].flatMap((s) => keywordIds(s.prompts))
    expect(await rowsOf(ids, date)).toEqual([])
  })

  it('組織ごとのモードで行を作る', async () => {
    const live = await seedBrand({ keywords: [uniqueKeyword('live')] })
    const fake = await seedBrand({ keywords: [uniqueKeyword('fake')] })
    const date = nextDate()

    await claimDailySerpTasks(db, date, (orgId) =>
      orgId === live.brand.organizationId ? 'live' : 'fake',
    )

    const [liveRow] = await rowsOf(keywordIds(live.prompts), date)
    const [fakeRow] = await rowsOf(keywordIds(fake.prompts), date)
    expect(liveRow?.mode).toBe('live')
    expect(fakeRow?.mode).toBe('fake')
  })
})

describe('postSerpTasks / collectSerpResults（フェイクで一通り）', () => {
  it('頼んで task ID と費用を保存し、結果を取りに行って保存する', async () => {
    const { prompts } = await seedBrand({ keywords: [uniqueKeyword('クラウド会計')] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'fake' }])
    const deps = depsWith({ fake: createFakeSerpProvider() })

    const posted = await postSerpTasks(deps, date, UNLIMITED)
    expect(posted.remaining).toBe(0)
    const [afterPost] = await rowsOf(ids, date)
    expect(afterPost?.taskId).toMatch(/^fake-/)
    expect(afterPost?.costUsd).toBe(0)
    expect(afterPost?.status).toBe('pending')

    const collected = await collectSerpResults(deps, date, UNLIMITED)
    expect(collected).toMatchObject({ pending: 0, remaining: 0 })
    const [row] = await rowsOf(ids, date)
    expect(row?.status).toBe('succeeded')
    expect(row?.raw).toBeTruthy()
    expect(row?.aiOverviewPresent).not.toBeNull()
    // 自社と競合 2 社の 3 行
    const entities = await db.select().from(serpEntity).where(eq(serpEntity.serpResultId, row!.id))
    expect(entities).toHaveLength(3)
  })
})

/** ◯◯会計（maru.example.com）が 3 位で、AI による概要には ◯◯会計 と 競合A が出る検索結果 */
const knownSerp: ParsedSerp = {
  organic: [
    {
      rank: 1,
      rankAbsolute: 2,
      domain: 'hikaku.example',
      url: 'https://hikaku.example/',
      title: null,
    },
    {
      rank: 2,
      rankAbsolute: 3,
      domain: 'maru.example.com.evil.test',
      url: 'https://maru.example.com.evil.test/',
      title: null,
    },
    {
      rank: 3,
      rankAbsolute: 4,
      domain: 'www.maru.example.com',
      url: 'https://www.maru.example.com/a',
      title: null,
    },
    {
      rank: 7,
      rankAbsolute: 8,
      domain: 'blog.maru.example.com',
      url: 'https://blog.maru.example.com/b',
      title: null,
    },
  ],
  aiOverview: {
    asynchronous: true,
    text: '会計ソフトなら◯◯会計と競合Aがよく選ばれています。',
    references: [
      { url: 'https://www.maru.example.com/guide', title: '公式ガイド' },
      { url: 'https://hikaku.example/x', title: '比較' },
    ],
  },
}

describe('検索結果の照らし合わせ', () => {
  it('順位はドメインで照合する（www・サブドメインも同じサイト。いちばん上の順位）。ドメインが未設定なら null', async () => {
    const { brand, prompts } = await seedBrand({ keywords: [uniqueKeyword('照合')] })
    await db
      .update(competitor)
      .set({ domain: 'kyougou-a.example' })
      .where(and(eq(competitor.brandId, brand.id), eq(competitor.name, '競合A')))
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'fake' }])
    const provider = recordingProvider('fake', {
      fetch: async () => ({ status: 'ready', serp: knownSerp, raw: { items: [] } }),
    })
    const deps = depsWith({ fake: provider.provider })

    await postSerpTasks(deps, date, UNLIMITED)
    await collectSerpResults(deps, date, UNLIMITED)

    const [row] = await rowsOf(ids, date)
    expect(row).toMatchObject({
      status: 'succeeded',
      aiOverviewPresent: true,
      aiOverviewAsynchronous: true,
      aiOverviewText: '会計ソフトなら◯◯会計と競合Aがよく選ばれています。',
      extractorModel: 'rule-based',
    })
    const entities = await db
      .select({
        name: competitor.name,
        entityType: serpEntity.entityType,
        organicRank: serpEntity.organicRank,
        organicUrl: serpEntity.organicUrl,
        aiOverviewMentioned: serpEntity.aiOverviewMentioned,
      })
      .from(serpEntity)
      .leftJoin(competitor, eq(competitor.id, serpEntity.competitorId))
      .where(eq(serpEntity.serpResultId, row!.id))
    expect(entities).toEqual(
      expect.arrayContaining([
        {
          name: null,
          entityType: 'brand',
          organicRank: 3,
          organicUrl: 'https://www.maru.example.com/a',
          aiOverviewMentioned: true,
        },
        {
          name: '競合A',
          entityType: 'competitor',
          organicRank: null,
          organicUrl: null,
          aiOverviewMentioned: true,
        },
        {
          name: '競合B',
          entityType: 'competitor',
          organicRank: null,
          organicUrl: null,
          aiOverviewMentioned: false,
        },
      ]),
    )
    const references = await db
      .select()
      .from(serpAiOverviewReference)
      .where(eq(serpAiOverviewReference.serpResultId, row!.id))
      .orderBy(asc(serpAiOverviewReference.position))
    expect(references.map((r) => [r.domain, r.isOwnDomain])).toEqual([
      ['maru.example.com', true],
      ['hikaku.example', false],
    ])
  })

  it('AI による概要が出なければ、名前が出たかは null（「出なかった」と区別する）', async () => {
    const { prompts } = await seedBrand({ keywords: [uniqueKeyword('概要なし')] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'fake' }])
    const provider = recordingProvider('fake', {
      fetch: async () => ({
        status: 'ready',
        serp: { ...knownSerp, aiOverview: null },
        raw: {},
      }),
    })
    const deps = depsWith({ fake: provider.provider })

    await postSerpTasks(deps, date, UNLIMITED)
    await collectSerpResults(deps, date, UNLIMITED)

    const [row] = await rowsOf(ids, date)
    expect(row).toMatchObject({ aiOverviewPresent: false, extractorModel: null })
    const entities = await db.select().from(serpEntity).where(eq(serpEntity.serpResultId, row!.id))
    expect(entities.map((e) => e.aiOverviewMentioned)).toEqual([null, null, null])
  })
})

describe('二重に課金しない', () => {
  it('何度呼んでも、同じキーワードは 1 回しか頼まない', async () => {
    const keyword = uniqueKeyword('二重')
    const { prompts } = await seedBrand({ keywords: [keyword] })
    const date = nextDate()
    const provider = recordingProvider('fake')
    const deps = depsWith({ fake: provider.provider })

    await claimDailySerpTasks(db, date, allFake)
    await postSerpTasks(deps, date, UNLIMITED)
    await claimDailySerpTasks(db, date, allFake)
    await postSerpTasks(deps, date, UNLIMITED)
    await collectSerpResults(deps, date, UNLIMITED)
    await postSerpTasks(deps, date, UNLIMITED)

    expect(provider.posted.filter((k) => k === keyword)).toHaveLength(1)
    expect(await rowsOf(keywordIds(prompts), date)).toHaveLength(1)
  })

  it('同時に 2 つ呼ばれても、同じキーワードは 1 回しか頼まない', async () => {
    const keyword = uniqueKeyword('同時')
    const { prompts } = await seedBrand({ keywords: [keyword] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'fake' }])
    const fake = createFakeSerpProvider()
    // 頼むのに時間がかかる（その間にもう 1 つの呼び出しが同じ行を読む）
    const provider = recordingProvider('fake', {
      post: async (k) => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return fake.postTask({ keyword: k })
      },
    })
    const deps = depsWith({ fake: provider.provider })
    const options = { ...UNLIMITED, promptIds: ids }

    await Promise.all([postSerpTasks(deps, date, options), postSerpTasks(deps, date, options)])

    expect(provider.posted.filter((k) => k === keyword)).toHaveLength(1)
  })

  it('頼み始めたあと task ID を保存する前に落ちた行は、頼み直さず、諦めるときに理由を残す', async () => {
    const keyword = uniqueKeyword('途中で落ちた')
    const { prompts } = await seedBrand({ keywords: [keyword] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'fake' }])
    // 頼み始めた印だけが入っている（task_post の途中で関数が落ちた）
    await db
      .update(serpResult)
      .set({ postAttemptedAt: new Date() })
      .where(inArray(serpResult.promptId, ids))
    const provider = recordingProvider('fake')

    await postSerpTasks(depsWith({ fake: provider.provider }), date, UNLIMITED)
    expect(provider.posted).not.toContain(keyword)

    await giveUpSerpTasks(db, date)
    const [row] = await rowsOf(ids, date)
    expect(row?.status).toBe('failed')
    expect(row?.error).toMatch(/頼めたか確かめられませんでした/)
  })

  it('頼む前に保存した task ID で、やり直しのときは結果だけを取りに行く', async () => {
    const keyword = uniqueKeyword('やり直し')
    const { prompts } = await seedBrand({ keywords: [keyword] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'fake' }])
    let ready = false
    const provider = recordingProvider('fake', {
      fetch: async () =>
        ready ? { status: 'ready', serp: knownSerp, raw: {} } : { status: 'pending' },
    })
    const deps = depsWith({ fake: provider.provider })
    await postSerpTasks(deps, date, UNLIMITED)

    expect((await collectSerpResults(deps, date, UNLIMITED)).pending).toBeGreaterThan(0)
    expect((await rowsOf(ids, date))[0]?.status).toBe('pending')
    ready = true
    await collectSerpResults(deps, date, UNLIMITED)

    expect((await rowsOf(ids, date))[0]?.status).toBe('succeeded')
    expect(provider.posted.filter((k) => k === keyword)).toHaveLength(1)
    expect(provider.fetched.filter((k) => k === keyword)).toHaveLength(2)
  })
})

describe('失敗したキーワード', () => {
  it('頼むのに失敗したキーワードだけ failed にして、ほかは続ける', async () => {
    const bad = uniqueKeyword('失敗する')
    const good = uniqueKeyword('成功する')
    const { prompts } = await seedBrand({ keywords: [bad, good] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(
      db,
      date,
      ids.map((promptId) => ({ promptId, mode: 'fake' as const })),
    )
    const fake = createFakeSerpProvider()
    const provider = recordingProvider('fake', {
      post: async (keyword) => {
        if (keyword === bad) throw new SerpApiError('Payment Required.', 40200)
        return fake.postTask({ keyword })
      },
    })
    const deps = depsWith({ fake: provider.provider })

    await postSerpTasks(deps, date, UNLIMITED)
    await collectSerpResults(deps, date, UNLIMITED)

    const rows = await db
      .select({ text: prompt.text, status: serpResult.status, error: serpResult.error })
      .from(serpResult)
      .innerJoin(prompt, eq(prompt.id, serpResult.promptId))
      .where(and(inArray(serpResult.promptId, ids), eq(serpResult.searchedOn, date)))
    expect(rows).toEqual(
      expect.arrayContaining([
        { text: bad, status: 'failed', error: expect.stringMatching(/Payment Required/) },
        { text: good, status: 'succeeded', error: null },
      ]),
    )
  })

  it('結果の取得でタスクのエラーが返ったら failed、通信のエラーなら pending のまま取り直す', async () => {
    const taskError = uniqueKeyword('タスクのエラー')
    const networkError = uniqueKeyword('通信のエラー')
    const { prompts } = await seedBrand({ keywords: [taskError, networkError] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(
      db,
      date,
      ids.map((promptId) => ({ promptId, mode: 'fake' as const })),
    )
    const provider = recordingProvider('fake', {
      fetch: async (keyword) => {
        if (keyword === taskError) throw new SerpApiError('Task Not Found.', 40400)
        throw new TypeError('fetch failed')
      },
    })
    const deps = depsWith({ fake: provider.provider })
    await postSerpTasks(deps, date, UNLIMITED)

    await collectSerpResults(deps, date, UNLIMITED)

    const rows = await db
      .select({ text: prompt.text, status: serpResult.status })
      .from(serpResult)
      .innerJoin(prompt, eq(prompt.id, serpResult.promptId))
      .where(and(inArray(serpResult.promptId, ids), eq(serpResult.searchedOn, date)))
    expect(rows).toEqual(
      expect.arrayContaining([
        { text: taskError, status: 'failed' },
        { text: networkError, status: 'pending' },
      ]),
    )

    // 待つのをやめたら、結果待ちの行は理由つきで failed にする
    await giveUpSerpTasks(db, date)
    const [left] = await db
      .select({ status: serpResult.status, error: serpResult.error })
      .from(serpResult)
      .innerJoin(prompt, eq(prompt.id, serpResult.promptId))
      .where(and(eq(prompt.text, networkError), eq(serpResult.searchedOn, date)))
    expect(left).toEqual({ status: 'failed', error: '時間内に検索の結果が出ませんでした' })
  })
})

describe('本物の DataForSEO を使う組織', () => {
  it('SERP_MODE=live でも、許可の一覧にない組織では本物の API を呼ばない', async () => {
    const liveKeyword = uniqueKeyword('許可された組織')
    const fakeKeyword = uniqueKeyword('許可されていない組織')
    const allowed = await seedBrand({ keywords: [liveKeyword] })
    await seedBrand({ keywords: [fakeKeyword] })
    const policy = createSerpPolicy({
      SERP_MODE: 'live',
      LIVE_ORGANIZATION_IDS: allowed.brand.organizationId,
    })
    const live = recordingProvider('live')
    const fake = recordingProvider('fake')
    const deps = depsWith({ live: live.provider, fake: fake.provider })
    const date = nextDate()

    await claimDailySerpTasks(db, date, policy.modeFor)
    await postSerpTasks(deps, date, UNLIMITED)
    await collectSerpResults(deps, date, UNLIMITED)

    expect(live.posted).toEqual([liveKeyword])
    expect(live.fetched).toEqual([liveKeyword])
    expect(fake.posted).toContain(fakeKeyword)
    expect(fake.posted).not.toContain(liveKeyword)
  })
})

describe('本物の DataForSEO の許可がなくなった組織（頼む・取りに行く直前に確かめる）', () => {
  /** live の行を作る。allowed の組織だけ本物を使ってよい */
  async function liveRow(label: string) {
    const keyword = uniqueKeyword(label)
    const { brand, prompts } = await seedBrand({ keywords: [keyword] })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(db, date, [{ promptId: ids[0]!, mode: 'live' }])
    const revoked = (organizationId: string): SerpMode =>
      organizationId === brand.organizationId ? 'fake' : 'live'
    return { keyword, date, ids, revoked }
  }

  it('頼む前に許可がなくなったら、本物にもフェイクにも頼まず、理由を付けて終わらせる', async () => {
    const { keyword, date, ids, revoked } = await liveRow('頼む前に取り消し')
    const live = recordingProvider('live')
    const fake = recordingProvider('fake')

    await postSerpTasks(depsWith({ live: live.provider, fake: fake.provider }, revoked), date, {
      ...UNLIMITED,
      promptIds: ids,
    })

    expect(live.posted).not.toContain(keyword)
    expect(fake.posted).not.toContain(keyword)
    const [row] = await rowsOf(ids, date)
    expect(row).toMatchObject({ status: 'failed', taskId: null })
    expect(row?.error).toMatch(/本物の DataForSEO を使う許可がなくなった/)
  })

  it('頼んだあとに許可がなくなったら、保存した本物の task ID で取りに行かず、フェイクにも渡さない', async () => {
    const { keyword, date, ids, revoked } = await liveRow('取りに行く前に取り消し')
    const live = recordingProvider('live')
    const fake = recordingProvider('fake')
    const options = { ...UNLIMITED, promptIds: ids }
    await postSerpTasks(depsWith({ live: live.provider }), date, options)
    const [posted] = await rowsOf(ids, date)
    expect(posted?.taskId).toBeTruthy()

    await collectSerpResults(
      depsWith({ live: live.provider, fake: fake.provider }, revoked),
      date,
      options,
    )

    expect(live.fetched).not.toContain(keyword)
    expect(fake.fetched).not.toContain(keyword)
    const [row] = await rowsOf(ids, date)
    expect(row).toMatchObject({ status: 'failed', taskId: posted?.taskId })
    expect(row?.error).toMatch(/本物の DataForSEO を使う許可がなくなった/)
  })

  it('許可が続いていれば、live の行は本物で頼んで取りに行く', async () => {
    const { keyword, date, ids } = await liveRow('許可あり')
    const live = recordingProvider('live')
    const deps = depsWith({ live: live.provider })
    const options = { ...UNLIMITED, promptIds: ids }

    await postSerpTasks(deps, date, options)
    await collectSerpResults(deps, date, options)

    expect(live.posted).toEqual([keyword])
    expect(live.fetched).toEqual([keyword])
    expect((await rowsOf(ids, date))[0]?.status).toBe('succeeded')
  })
})

describe('結果を取りに行く順番（未完了の行ばかり繰り返さない）', () => {
  /** いつまでも結果が出ない（pending を返す）キーワードを 3 つ、頼んだ状態にする */
  async function threePendingKeywords() {
    const keywords = [uniqueKeyword('先頭'), uniqueKeyword('2 番目'), uniqueKeyword('3 番目')]
    const { prompts } = await seedBrand({ keywords })
    const date = nextDate()
    const ids = keywordIds(prompts)
    await claimSerpTasks(
      db,
      date,
      ids.map((promptId) => ({ promptId, mode: 'fake' as const })),
    )
    const provider = recordingProvider('fake', { fetch: async () => ({ status: 'pending' }) })
    const deps = depsWith({ fake: provider.provider })
    await postSerpTasks(deps, date, { ...UNLIMITED, promptIds: ids })
    // 予算 0：1 回の呼び出しで 1 行だけ取りに行く
    const options = { budgetMs: 0, promptIds: ids }
    return { keywords, date, deps, provider, options }
  }

  it('カーソルを渡すと、前の呼び出しの続きの行から取りに行く', async () => {
    const { keywords, date, deps, provider, options } = await threePendingKeywords()

    const first = await collectSerpResults(deps, date, options)
    const second = await collectSerpResults(deps, date, { ...options, after: first.cursor })
    const third = await collectSerpResults(deps, date, { ...options, after: second.cursor })

    expect(provider.fetched).toEqual(keywords)
    expect([first.remaining, second.remaining, third.remaining]).toEqual([2, 1, 0])
    expect(third.cursor).toBeNull()
  })

  it('1 回の取得ラウンドで全部の行を 1 回ずつ確かめ、未完了が残っていれば次の待ちに進む。上限の回数で止まる', async () => {
    const { keywords, date, deps, provider, options } = await threePendingKeywords()
    const names: string[] = []
    const steps = {
      run: async <T>(name: string, fn: () => Promise<T>) => {
        names.push(name)
        return fn()
      },
      sleep: async (name: string) => {
        names.push(name)
      },
    }

    const result = await waitAndCollectSerpResults(
      steps,
      (after) => collectSerpResults(deps, date, { ...options, after }),
      { maxRounds: 2 },
    )

    expect(result).toEqual({ rounds: 2, pending: 3 })
    expect(provider.fetched).toEqual([...keywords, ...keywords])
    expect(names).toEqual([
      'wait-1',
      'collect-1-1',
      'collect-1-2',
      'collect-1-3',
      'wait-2',
      'collect-2-1',
      'collect-2-2',
      'collect-2-3',
    ])
  })

  it('未完了の行がなくなったら、上限より前に止まる', async () => {
    const { date, deps, options } = await threePendingKeywords()
    const ready = depsWith({
      fake: recordingProvider('fake', {
        fetch: async () => ({ status: 'ready', serp: knownSerp, raw: {} }),
      }).provider,
    })
    const steps = {
      run: async <T>(_name: string, fn: () => Promise<T>) => fn(),
      sleep: async () => {},
    }
    void deps

    const result = await waitAndCollectSerpResults(
      steps,
      (after) => collectSerpResults(ready, date, { ...options, after }),
      { maxRounds: 12 },
    )

    expect(result).toEqual({ rounds: 1, pending: 0 })
  })
})

describe('recoverStaleSerpResults（ジョブが消えて残った pending の行の回収）', () => {
  /** 状態の違う pending の行を 3 つ（頼む前・頼み始めて task ID がない・task ID がある）作る */
  async function pendingRowsInEachState() {
    const keywords = {
      notPosted: uniqueKeyword('頼む前'),
      attempted: uniqueKeyword('頼み始めた'),
      posted: uniqueKeyword('頼んだ'),
    }
    const { prompts } = await seedBrand({ keywords: Object.values(keywords) })
    const date = nextDate()
    const idOf = (text: string) => prompts.find((p) => p.text === text)!.id
    await claimSerpTasks(
      db,
      date,
      Object.values(keywords).map((k) => ({ promptId: idOf(k), mode: 'fake' as const })),
    )
    await db
      .update(serpResult)
      .set({ postAttemptedAt: new Date() })
      .where(eq(serpResult.promptId, idOf(keywords.attempted)))
    await db
      .update(serpResult)
      .set({ postAttemptedAt: new Date(), taskId: 'task-1', postedAt: new Date() })
      .where(eq(serpResult.promptId, idOf(keywords.posted)))
    return { keywords, date, idOf, ids: keywordIds(prompts) }
  }

  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000)

  it('期限を過ぎた pending の行を、状態ごとの理由を付けて failed にする', async () => {
    const { keywords, date, idOf, ids } = await pendingRowsInEachState()
    await db
      .update(serpResult)
      .set({ createdAt: hoursAgo(4) })
      .where(inArray(serpResult.promptId, ids))

    const recovered = await recoverStaleSerpResults(db)

    expect(recovered).toBeGreaterThanOrEqual(3)
    const errorOf = async (text: string) => (await rowsOf([idOf(text)], date))[0]?.error
    expect(await errorOf(keywords.notPosted)).toBe('検索を頼む前に、ジョブが終わりました')
    expect(await errorOf(keywords.attempted)).toMatch(/頼めたか確かめられませんでした/)
    expect(await errorOf(keywords.posted)).toBe('時間内に検索の結果が出ませんでした')
    expect((await rowsOf(ids, date)).map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('期限内の pending の行と、終わった行には触らない', async () => {
    const { date, ids } = await pendingRowsInEachState()

    await recoverStaleSerpResults(db)

    expect((await rowsOf(ids, date)).map((r) => r.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
  })

  it('頼み始めた印があって task ID のない行は、回収したあとも頼み直さない', async () => {
    const { keywords, date, ids } = await pendingRowsInEachState()
    await db
      .update(serpResult)
      .set({ createdAt: hoursAgo(4) })
      .where(inArray(serpResult.promptId, ids))
    await recoverStaleSerpResults(db)
    const provider = recordingProvider('fake')

    await postSerpTasks(depsWith({ fake: provider.provider }), date, {
      ...UNLIMITED,
      promptIds: ids,
    })

    expect(provider.posted).not.toContain(keywords.attempted)
    expect(provider.posted).toEqual([])
  })

  it('期限は変えられる（既定は、毎朝のジョブが待つ上限より十分長い）', async () => {
    const { date, ids } = await pendingRowsInEachState()
    await db
      .update(serpResult)
      .set({ createdAt: hoursAgo(2) })
      .where(inArray(serpResult.promptId, ids))

    await recoverStaleSerpResults(db)
    expect((await rowsOf(ids, date)).every((r) => r.status === 'pending')).toBe(true)

    await recoverStaleSerpResults(db, { staleAfterMinutes: 60 })
    expect((await rowsOf(ids, date)).every((r) => r.status === 'failed')).toBe(true)
  })
})

describe('対象のキーワードを絞る（デモデータの作成用）', () => {
  it('promptIds を渡すと、同じ日のほかのキーワードの行には触らない', async () => {
    const mine = uniqueKeyword('自分の')
    const others = uniqueKeyword('ほかの組織の')
    const a = await seedBrand({ keywords: [mine] })
    const b = await seedBrand({ keywords: [others] })
    const date = nextDate()
    const aIds = keywordIds(a.prompts)
    const bIds = keywordIds(b.prompts)
    await claimSerpTasks(db, date, [
      { promptId: aIds[0]!, mode: 'fake' },
      { promptId: bIds[0]!, mode: 'live' },
    ])
    const provider = recordingProvider('fake')
    const deps = depsWith({ fake: provider.provider })
    const options = { ...UNLIMITED, promptIds: aIds }

    await postSerpTasks(deps, date, options)
    await collectSerpResults(deps, date, options)

    expect(provider.posted).toEqual([mine])
    expect((await rowsOf(aIds, date))[0]?.status).toBe('succeeded')
    expect((await rowsOf(bIds, date))[0]).toMatchObject({
      status: 'pending',
      postAttemptedAt: null,
    })
  })
})
