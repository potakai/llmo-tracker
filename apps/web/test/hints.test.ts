import { describe, expect, it } from 'vitest'
import {
  buildHints,
  HINT_WINDOW_DAYS,
  type HintInput,
  type HintResponse,
  hintPriority,
  MAX_HINTS,
  MIN_GAP,
  MIN_GROUP_RESPONSES,
  MIN_NEGATIVE_RESPONSES,
  MIN_RESPONSES,
  MIN_SITE_CITATIONS,
  OWN_SITE_RARE_RATE,
} from '@/lib/hints'
import { addDays } from '@/lib/stats'

const RIVAL_A = { id: 'c-a', name: 'ミライ会計', domain: 'mirai.example' }
const RIVAL_B = { id: 'c-b', name: 'ラクラク帳簿', domain: null }

/** テストの「今日」。回答の日付は、指定しなければ今日 */
const TODAY = '2026-11-22'

let seq = 0
/** 回答 1 件。何も指定しなければ「質問 p1・自社も競合も出てこない・引用なし」 */
function answer(overrides: Partial<HintResponse> = {}): HintResponse {
  seq += 1
  return {
    id: `r-${seq}`,
    promptId: 'p1',
    promptText: 'おすすめの会計ソフトは？',
    date: TODAY,
    isPromptActive: true,
    brandMentioned: false,
    sentiment: null,
    answerText: null,
    competitorIds: [],
    citedDomains: [],
    ...overrides,
  }
}

function times(n: number, overrides: Partial<HintResponse> = {}) {
  return Array.from({ length: n }, () => answer(overrides))
}

function input(responses: HintResponse[], overrides: Partial<HintInput> = {}): HintInput {
  return {
    brand: { name: 'サンプル会計', aliases: [], domain: 'sample.example' },
    competitors: [RIVAL_A, RIVAL_B],
    responses,
    collection: { scheduleEnabled: true, activePrompts: 2, responsesPerDay: 20 },
    today: TODAY,
    ...overrides,
  }
}

/** 何の施策も出ない、データ量だけを満たす回答（自社も競合も出て、自社サイトがよく引用される） */
function neutralFiller(n = MIN_RESPONSES) {
  return times(n, {
    promptId: 'p-filler',
    brandMentioned: true,
    competitorIds: [RIVAL_A.id],
    citedDomains: ['sample.example'],
  })
}

function hintsOf(data: HintInput) {
  const result = buildHints(data)
  if (result.status !== 'ready') throw new Error(`ready ではない：${result.status}`)
  return result.hints
}

describe('優先度の計算式', () => {
  it('差 × √(母数の回答数) で決まる', () => {
    expect(hintPriority({ responses: 100, gap: 0.5 })).toBe(5)
    expect(hintPriority({ responses: 25, gap: 0.2 })).toBeCloseTo(1)
    expect(hintPriority({ responses: 0, gap: 0.5 })).toBe(0)
  })

  it('差が同じなら回答が多いほう、回答数が同じなら差が大きいほうが上になる', () => {
    expect(hintPriority({ responses: 40, gap: 0.3 })).toBeGreaterThan(
      hintPriority({ responses: 20, gap: 0.3 }),
    )
    expect(hintPriority({ responses: 20, gap: 0.4 })).toBeGreaterThan(
      hintPriority({ responses: 20, gap: 0.3 }),
    )
  })
})

describe('データが少ないとき', () => {
  const collection = (responsesPerDay: number, overrides = {}) => ({
    collection: { scheduleEnabled: true, activePrompts: 1, responsesPerDay, ...overrides },
  })

  it(`回答が ${MIN_RESPONSES} 件未満なら、施策を出さずに待つ日数を返す`, () => {
    const result = buildHints(input(times(MIN_RESPONSES - 1, { competitorIds: [RIVAL_A.id] })))
    expect(result).toEqual({
      status: 'waiting',
      responses: MIN_RESPONSES - 1,
      needed: MIN_RESPONSES,
      estimate: { kind: 'days', daysLeft: 1 },
    })
  })

  it('待つ日数は、足りない分を 1 日に集まる回答数で割って切り上げる', () => {
    // 1 日 10 件、いま 45 件 → あと 5 件 → 1 日
    const result = buildHints(input(times(45), collection(10)))
    expect(result).toMatchObject({ estimate: { kind: 'days', daysLeft: 1 } })
    // 1 日 4 件、いま 40 件 → あと 10 件 → 3 日
    expect(buildHints(input(times(40), collection(4)))).toMatchObject({
      estimate: { kind: 'days', daysLeft: 3 },
    })
  })

  it(`古い回答が日ごとに ${HINT_WINDOW_DAYS} 日の範囲から抜けていくことも数える（${MIN_RESPONSES - 1} 件がすべて最古の日・1 日 4 件）`, () => {
    // 1 日後に最古の日の 49 件が抜けるので、新しい回答だけで 50 件に届く 13 日後（52 件）
    const oldest = addDays(TODAY, -(HINT_WINDOW_DAYS - 1))
    const result = buildHints(input(times(MIN_RESPONSES - 1, { date: oldest }), collection(4)))
    expect(result).toMatchObject({ estimate: { kind: 'days', daysLeft: 13 } })
  })

  it('抜けていく回答があっても、残る回答と新しい回答で先に届けば、その日を返す', () => {
    // 最古の日に 10 件・今日に 30 件、1 日 10 件
    // 1 日後：30 + 10 = 40、2 日後：30 + 20 = 50 → 2 日
    const oldest = addDays(TODAY, -(HINT_WINDOW_DAYS - 1))
    const responses = [...times(10, { date: oldest }), ...times(30)]
    expect(buildHints(input(responses, collection(10)))).toMatchObject({
      estimate: { kind: 'days', daysLeft: 2 },
    })
  })

  it(`1 日の件数 × ${HINT_WINDOW_DAYS} 日が ${MIN_RESPONSES} 件に届かない設定なら、日数ではなく届かないことを返す`, () => {
    const reachable = Math.ceil(MIN_RESPONSES / HINT_WINDOW_DAYS)
    expect(buildHints(input(times(10), collection(reachable)))).toMatchObject({
      estimate: { kind: 'days' },
    })
    expect(buildHints(input(times(10), collection(reachable - 1)))).toMatchObject({
      estimate: { kind: 'unreachable', responsesPerDay: reachable - 1 },
    })
  })

  it('自動計測がオフなら、そのことを返す', () => {
    const result = buildHints(input([], collection(20, { scheduleEnabled: false })))
    expect(result).toMatchObject({ responses: 0, estimate: { kind: 'scheduleOff' } })
  })

  it('有効な質問が 0 件なら、自動計測がオフでも、質問がないことを先に返す', () => {
    const result = buildHints(
      input([], collection(0, { scheduleEnabled: false, activePrompts: 0 })),
    )
    expect(result).toMatchObject({ estimate: { kind: 'noActivePrompts' } })
  })

  it(`回答がちょうど ${MIN_RESPONSES} 件あれば、施策を出す`, () => {
    expect(buildHints(input(neutralFiller(MIN_RESPONSES))).status).toBe('ready')
  })
})

describe('名前が出にくい質問', () => {
  /** 質問 p2 に n 件。競合 A は competitorHits 件、自社は brandHits 件に出る */
  function promptAnswers(n: number, competitorHits: number, brandHits: number) {
    return Array.from({ length: n }, (_, i) =>
      answer({
        promptId: 'p2',
        promptText: '会計ソフト 安い',
        competitorIds: i < competitorHits ? [RIVAL_A.id] : [],
        brandMentioned: i < brandHits,
      }),
    )
  }

  it('競合が出ているのに自社が出ていない質問を、競合の名前と割合つきで出す', () => {
    const hints = hintsOf(input([...neutralFiller(), ...promptAnswers(20, 16, 2)]))
    const hint = hints.find((h) => h.kind === 'prompt')
    expect(hint).toMatchObject({
      kind: 'prompt',
      promptId: 'p2',
      promptText: '会計ソフト 安い',
      competitorNames: ['ミライ会計'],
      competitorRate: 0.8,
      brandRate: 0.1,
      responses: 20,
    })
    expect(hint?.priority).toBeCloseTo(hintPriority({ responses: 20, gap: 0.7 }))
    expect(hint?.kind === 'prompt' && hint.evidenceResponseIds).toHaveLength(10)
  })

  it(`差がちょうど ${MIN_GAP} なら出し、それより小さければ出さない`, () => {
    // 10 件中 競合 4 件・自社 2 件 → 差 0.2
    const atGap = hintsOf(input([...neutralFiller(), ...promptAnswers(10, 4, 2)]))
    expect(atGap.some((h) => h.kind === 'prompt')).toBe(true)
    // 10 件中 競合 4 件・自社 3 件 → 差 0.1
    const belowGap = hintsOf(input([...neutralFiller(), ...promptAnswers(10, 4, 3)]))
    expect(belowGap.some((h) => h.kind === 'prompt')).toBe(false)
  })

  it(`質問への回答が ${MIN_GROUP_RESPONSES} 件未満なら、差が大きくても出さない`, () => {
    const hints = hintsOf(
      input([...neutralFiller(), ...promptAnswers(MIN_GROUP_RESPONSES - 1, 9, 0)]),
    )
    expect(hints.some((h) => h.kind === 'prompt')).toBe(false)
  })

  it('競合の名前は、よく出てくる順に並べ、割合はいちばん出ている競合のものを使う', () => {
    // 登録順は A → B だが、B のほうがよく出てくる（A は 20 件中 6 件、B は 16 件）
    const responses = Array.from({ length: 20 }, (_, i) =>
      answer({
        promptId: 'p6',
        competitorIds: [...(i < 6 ? [RIVAL_A.id] : []), ...(i < 16 ? [RIVAL_B.id] : [])],
      }),
    )
    const hint = hintsOf(input([...neutralFiller(), ...responses])).find((h) => h.kind === 'prompt')
    expect(hint).toMatchObject({
      competitorNames: ['ラクラク帳簿', 'ミライ会計'],
      competitorRate: 0.8,
      brandRate: 0,
    })
  })

  it('アーカイブした質問は出さない（もう計測していない）', () => {
    const archived = promptAnswers(20, 20, 0).map((r) => ({ ...r, isPromptActive: false }))
    const hints = hintsOf(input([...neutralFiller(), ...archived]))
    expect(hints.some((h) => h.kind === 'prompt')).toBe(false)
  })
})

describe('載るべきサイト', () => {
  /**
   * 競合だけが出る回答 n 件のうち siteHits 件で ranking.example を引用し、
   * 自社が出る回答 n 件のうち brandSiteHits 件でも引用する
   */
  function siteAnswers(n: number, siteHits: number, brandSiteHits: number) {
    return [
      ...Array.from({ length: n }, (_, i) =>
        answer({
          promptId: 'p3',
          competitorIds: [RIVAL_A.id, RIVAL_B.id],
          citedDomains: i < siteHits ? ['ranking.example'] : ['other.example'],
        }),
      ),
      ...Array.from({ length: n }, (_, i) =>
        answer({
          promptId: 'p4',
          brandMentioned: true,
          citedDomains: i < brandSiteHits ? ['ranking.example'] : ['sample.example'],
        }),
      ),
    ]
  }

  it('競合が出る回答でよく引用され、自社が出る回答では引用されないサイトを出す', () => {
    const hints = hintsOf(input(siteAnswers(30, 15, 0)))
    const hint = hints.find((h) => h.kind === 'site' && h.domain === 'ranking.example')
    expect(hint).toMatchObject({
      kind: 'site',
      domain: 'ranking.example',
      competitorNames: ['ミライ会計', 'ラクラク帳簿'],
      competitorRate: 0.5,
      brandRate: 0,
      responses: 30,
    })
    expect(hint?.kind === 'site' && hint.evidenceResponseIds).toHaveLength(10)
  })

  it(`差がちょうど ${MIN_GAP} なら出し、それより小さければ出さない`, () => {
    // 競合側 30 件中 9 件（0.3）、自社側 30 件中 3 件（0.1）→ 差 0.2
    const atGap = hintsOf(input(siteAnswers(30, 9, 3)))
    expect(atGap.some((h) => h.kind === 'site' && h.domain === 'ranking.example')).toBe(true)
    // 自社側 30 件中 4 件 → 差 0.1666…
    const belowGap = hintsOf(input(siteAnswers(30, 9, 4)))
    expect(belowGap.some((h) => h.kind === 'site' && h.domain === 'ranking.example')).toBe(false)
  })

  it(`引用が ${MIN_SITE_CITATIONS} 件未満なら出さない`, () => {
    // 競合側 20 件中 5 件（0.25）と 4 件（0.2）。どちらも差の条件は満たす
    const padding = times(MIN_RESPONSES)
    const atMin = hintsOf(input([...padding, ...siteAnswers(20, MIN_SITE_CITATIONS, 0)]))
    expect(atMin.some((h) => h.kind === 'site' && h.domain === 'ranking.example')).toBe(true)
    const belowMin = hintsOf(input([...padding, ...siteAnswers(20, MIN_SITE_CITATIONS - 1, 0)]))
    expect(belowMin.some((h) => h.kind === 'site' && h.domain === 'ranking.example')).toBe(false)
  })

  it(`自社の名前が出た回答が ${MIN_GROUP_RESPONSES} 件未満なら比べず、競合側の割合だけで出す`, () => {
    // 自社側 9 件はすべて ranking.example を引用している（比べれば差はない）
    const brandSide = times(MIN_GROUP_RESPONSES - 1, {
      brandMentioned: true,
      citedDomains: ['ranking.example'],
    })
    const competitorSide = Array.from({ length: 42 }, (_, i) =>
      answer({ competitorIds: [RIVAL_A.id], citedDomains: i < 21 ? ['ranking.example'] : [] }),
    )
    const hints = hintsOf(input([...brandSide, ...competitorSide]))
    expect(hints.find((h) => h.kind === 'site')).toMatchObject({
      domain: 'ranking.example',
      competitorRate: 0.5,
      brandRate: null,
      brandResponses: MIN_GROUP_RESPONSES - 1,
    })

    // ちょうど 10 件なら比べる → 自社側も 100% 引用しているので出さない
    const comparable = [
      ...brandSide,
      answer({ brandMentioned: true, citedDomains: ['ranking.example'] }),
    ]
    const compared = hintsOf(input([...comparable, ...competitorSide]))
    expect(compared.some((h) => h.kind === 'site')).toBe(false)
  })

  it(`比べないときも、競合側の割合が ${MIN_GAP} 未満なら出さない`, () => {
    const competitorSide = Array.from({ length: 50 }, (_, i) =>
      answer({ competitorIds: [RIVAL_A.id], citedDomains: i < 9 ? ['ranking.example'] : [] }),
    )
    const hints = hintsOf(input(competitorSide))
    expect(hints.some((h) => h.kind === 'site')).toBe(false)
  })

  it('自社サイトと、登録した競合のサイト（サブドメインを含む）は出さない', () => {
    const responses = [
      ...neutralFiller(),
      ...times(30, {
        competitorIds: [RIVAL_A.id],
        citedDomains: ['shop.mirai.example', 'blog.sample.example'],
      }),
    ]
    const hints = hintsOf(input(responses))
    expect(hints.filter((h) => h.kind === 'site')).toEqual([])
  })
})

describe('AI が書いている気になる点', () => {
  const NEGATIVE_TEXT =
    '1. ミライ会計：機能が充実しています。\n2. サンプル会計：サポートの返信が遅いという声もあります。\nほかにも候補があります。'

  it(`否定的な回答が ${MIN_NEGATIVE_RESPONSES} 件以上なら、否定的な箇所を前後の文つきで出す（同じ箇所は 1 つにまとめる）`, () => {
    const negatives = times(MIN_NEGATIVE_RESPONSES, {
      brandMentioned: true,
      sentiment: 'negative',
      answerText: NEGATIVE_TEXT,
    })
    const hints = hintsOf(input([...neutralFiller(), ...negatives]))
    const hint = hints.find((h) => h.kind === 'negative')
    expect(hint).toMatchObject({
      kind: 'negative',
      negativeResponses: MIN_NEGATIVE_RESPONSES,
      passages: [
        {
          before: 'ミライ会計：機能が充実しています。',
          focus: 'サンプル会計：サポートの返信が遅いという声もあります。',
          after: 'ほかにも候補があります。',
        },
      ],
      unlocatedResponses: 0,
      responses: MIN_RESPONSES + MIN_NEGATIVE_RESPONSES,
    })
    expect(hint?.kind === 'negative' && hint.evidenceResponseIds).toEqual(
      negatives.map((r) => r.id),
    )
  })

  it('否定的な箇所を言い回しから特定できない回答は、数だけ返す（回答全体を見てもらう）', () => {
    const negatives = [
      answer({ brandMentioned: true, sentiment: 'negative', answerText: NEGATIVE_TEXT }),
      answer({
        brandMentioned: true,
        sentiment: 'negative',
        answerText: 'サンプル会計はクラウド型の会計ソフトです。',
      }),
    ]
    const hint = hintsOf(input([...neutralFiller(), ...negatives])).find(
      (h) => h.kind === 'negative',
    )
    expect(hint).toMatchObject({ unlocatedResponses: 1 })
    expect(hint?.kind === 'negative' && hint.passages).toHaveLength(1)
    // 回答全体を見てもらうので、特定できなかった回答を根拠の先頭に並べる
    expect(hint?.kind === 'negative' && hint.evidenceResponseIds).toEqual([
      negatives[1]?.id,
      negatives[0]?.id,
    ])
  })

  it(`否定的な回答が ${MIN_NEGATIVE_RESPONSES - 1} 件だけなら出さない`, () => {
    const negatives = times(MIN_NEGATIVE_RESPONSES - 1, {
      brandMentioned: true,
      sentiment: 'negative',
      answerText: NEGATIVE_TEXT,
    })
    const hints = hintsOf(input([...neutralFiller(), ...negatives]))
    expect(hints.some((h) => h.kind === 'negative')).toBe(false)
  })
})

describe('自社サイトが参考にされていない', () => {
  /** 引用のある回答 n 件のうち ownHits 件で自社サイト、残りは比較サイトを引用 */
  function citedAnswers(n: number, ownHits: number) {
    return Array.from({ length: n }, (_, i) =>
      answer({
        promptId: 'p5',
        brandMentioned: true,
        competitorIds: [RIVAL_A.id],
        citedDomains: i < ownHits ? ['www2.sample.example'] : ['hikaku.example'],
      }),
    )
  }

  it(`自社サイトが引用された回答が ${OWN_SITE_RARE_RATE * 100}% 未満なら、いちばん多いサイトと並べて出す`, () => {
    const hints = hintsOf(input(citedAnswers(MIN_RESPONSES, 4)))
    const hint = hints.find((h) => h.kind === 'ownSite')
    expect(hint).toMatchObject({
      kind: 'ownSite',
      domain: 'sample.example',
      ownRate: 4 / MIN_RESPONSES,
      topDomain: 'hikaku.example',
      topRate: (MIN_RESPONSES - 4) / MIN_RESPONSES,
      responses: MIN_RESPONSES,
    })
    expect(hint?.kind === 'ownSite' && hint.evidenceDomains[0]).toEqual({
      domain: 'hikaku.example',
      responses: MIN_RESPONSES - 4,
      isOwn: false,
    })
  })

  it(`ちょうど ${OWN_SITE_RARE_RATE * 100}% なら出さない`, () => {
    const hints = hintsOf(input(citedAnswers(MIN_RESPONSES, MIN_RESPONSES * OWN_SITE_RARE_RATE)))
    expect(hints.some((h) => h.kind === 'ownSite')).toBe(false)
  })

  const noDomain = { brand: { name: 'サンプル会計', aliases: [], domain: null } }

  it('自社サイトのドメインが未設定なら、登録を案内する施策を先頭に出す', () => {
    const hints = hintsOf(input(citedAnswers(MIN_RESPONSES, 0), noDomain))
    expect(hints[0]).toMatchObject({
      kind: 'ownSiteSetup',
      responses: MIN_RESPONSES,
      evidenceDomains: [{ domain: 'hikaku.example', responses: MIN_RESPONSES, isOwn: false }],
    })
    expect(hints.some((h) => h.kind === 'ownSite')).toBe(false)
  })

  it('未設定なら、引用がまったくなくても登録を案内する', () => {
    const hints = hintsOf(input(times(MIN_RESPONSES), noDomain))
    expect(hints).toEqual([
      expect.objectContaining({ kind: 'ownSiteSetup', responses: 0, evidenceDomains: [] }),
    ])
  })

  it('未設定の案内は、案内自体の優先度が低くても（引用 0 件）、ほかの施策より先に出す', () => {
    const prompts = [0, 1, 2].flatMap((p) =>
      times(20, { promptId: `q${p}`, competitorIds: [RIVAL_A.id] }),
    )
    const hints = hintsOf(input(prompts, noDomain))
    expect(hints.map((h) => h.kind)).toEqual(['ownSiteSetup', 'prompt', 'prompt'])
    expect(hints[0]?.priority).toBeLessThan(hints[1]?.priority ?? 0)
  })

  it(`未設定の案内は、ほかの施策の優先度が高くても先頭に出し、合わせて ${MAX_HINTS} 件までにする`, () => {
    // 競合だけが出る質問 5 つ（どれも a.example と b.example を引用）→ 質問 5・サイト 2 の候補
    const prompts = [0, 1, 2, 3, 4].flatMap((p) =>
      times(20, {
        promptId: `q${p}`,
        competitorIds: [RIVAL_A.id],
        citedDomains: ['a.example', 'b.example'],
      }),
    )
    // 気になる点の候補（優先度はいちばん低い）
    const negatives = times(MIN_NEGATIVE_RESPONSES, {
      promptId: 'qn',
      brandMentioned: true,
      sentiment: 'negative',
      answerText: 'サンプル会計：サポートの返信が遅いという声もあります。',
    })
    const hints = hintsOf(input([...prompts, ...negatives], noDomain))
    expect(hints.map((h) => h.kind)).toEqual(['ownSiteSetup', 'site', 'site', 'prompt', 'prompt'])
  })

  it(`未設定の案内を出すときも、${MIN_RESPONSES} 件に届くまでは何も出さない`, () => {
    expect(buildHints(input(times(MIN_RESPONSES - 1), noDomain)).status).toBe('waiting')
  })

  it(`引用のある回答が ${MIN_GROUP_RESPONSES} 件未満なら出さない`, () => {
    const responses = [
      ...times(MIN_RESPONSES, { brandMentioned: true, competitorIds: [RIVAL_A.id] }),
      ...citedAnswers(MIN_GROUP_RESPONSES - 1, 0),
    ]
    expect(hintsOf(input(responses)).some((h) => h.kind === 'ownSite')).toBe(false)
  })
})

describe('並べ方', () => {
  it(`優先度の高い順に最大 ${MAX_HINTS} 件、1 種類につき 2 件まで出す`, () => {
    // 名前が出にくい質問を 4 つ（差がそれぞれ違う）＋ 自社サイトの施策
    const prompts = [0.9, 0.8, 0.7, 0.6].flatMap((rate, p) =>
      Array.from({ length: 20 }, (_, i) =>
        answer({
          promptId: `q${p}`,
          promptText: `質問${p}`,
          competitorIds: i < rate * 20 ? [RIVAL_A.id] : [],
          // 競合が出ない回答だけで引用する（載るべきサイトの施策は出さない）
          citedDomains: i < rate * 20 ? [] : ['hikaku.example'],
        }),
      ),
    )
    const hints = hintsOf(input(prompts))
    expect(hints.map((h) => h.kind)).toEqual(['ownSite', 'prompt', 'prompt'])
    expect(hints.filter((h) => h.kind === 'prompt').map((h) => h.promptId)).toEqual(['q0', 'q1'])
    const priorities = hints.map((h) => h.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a))
  })

  it('何も当てはまらなければ、空の一覧を返す', () => {
    expect(hintsOf(input(neutralFiller()))).toEqual([])
  })
})
