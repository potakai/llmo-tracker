import { describe, expect, it } from 'vitest'
import {
  buildHints,
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
  sentencesMentioning,
} from '@/lib/hints'

const RIVAL_A = { id: 'c-a', name: 'ミライ会計', domain: 'mirai.example' }
const RIVAL_B = { id: 'c-b', name: 'ラクラク帳簿', domain: null }

let seq = 0
/** 回答 1 件。何も指定しなければ「質問 p1・自社も競合も出てこない・引用なし」 */
function answer(overrides: Partial<HintResponse> = {}): HintResponse {
  seq += 1
  return {
    id: `r-${seq}`,
    promptId: 'p1',
    promptText: 'おすすめの会計ソフトは？',
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
    responsesPerDay: 20,
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
  it(`回答が ${MIN_RESPONSES} 件未満なら、施策を出さずに待つ日数を返す`, () => {
    const result = buildHints(input(times(MIN_RESPONSES - 1, { competitorIds: [RIVAL_A.id] })))
    expect(result).toEqual({
      status: 'waiting',
      responses: MIN_RESPONSES - 1,
      needed: MIN_RESPONSES,
      daysLeft: 1,
    })
  })

  it('待つ日数は、1 日に集まる回答数から切り上げで出す', () => {
    const result = buildHints(input(times(5), { responsesPerDay: 10 }))
    expect(result).toMatchObject({
      status: 'waiting',
      daysLeft: Math.ceil((MIN_RESPONSES - 5) / 10),
    })
  })

  it('毎日の計測が止まっている（1 日に集まる数が 0）なら、日数は出さない', () => {
    const result = buildHints(input([], { responsesPerDay: 0 }))
    expect(result).toMatchObject({ status: 'waiting', responses: 0, daysLeft: null })
  })

  it(`回答がちょうど ${MIN_RESPONSES} 件あれば、施策を出す`, () => {
    expect(buildHints(input(neutralFiller(MIN_RESPONSES))).status).toBe('ready')
  })
})

describe('すすめられていない質問', () => {
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

  it(`否定的な回答が ${MIN_NEGATIVE_RESPONSES} 件以上なら、自社について書いた文をそのまま出す`, () => {
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
      quotes: ['サンプル会計：サポートの返信が遅いという声もあります。'],
      responses: MIN_RESPONSES + MIN_NEGATIVE_RESPONSES,
    })
    expect(hint?.kind === 'negative' && hint.evidenceResponseIds).toEqual(
      negatives.map((r) => r.id),
    )
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

  it('自社サイトのドメインが未設定なら、設定を促す施策を出す', () => {
    const hints = hintsOf(
      input(citedAnswers(MIN_RESPONSES, 0), {
        brand: { name: 'サンプル会計', aliases: [], domain: null },
      }),
    )
    expect(hints.find((h) => h.kind === 'ownSite')).toMatchObject({
      kind: 'ownSite',
      domain: null,
      ownRate: null,
      topDomain: 'hikaku.example',
    })
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
    // すすめられていない質問を 4 つ（差がそれぞれ違う）＋ 自社サイトの施策
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

describe('自社について書いた文の抜き出し', () => {
  it('名前（表記ゆれ・別名を含む）が出てくる文だけを、重複なく返す', () => {
    const text =
      'ミライ会計が人気です。サンプル会計は料金が高めです！\n- さんぷる会計：設定が難しいとの声も。\nSK は機能が少ない。サンプル会計は料金が高めです！'
    expect(sentencesMentioning(text, ['サンプル会計', 'SK'])).toEqual([
      'サンプル会計は料金が高めです！',
      'さんぷる会計：設定が難しいとの声も。',
      'SK は機能が少ない。',
    ])
  })

  it('長すぎる文は切り詰める', () => {
    const long = `サンプル会計は${'あ'.repeat(300)}。`
    const [sentence] = sentencesMentioning(long, ['サンプル会計'])
    expect(sentence?.length).toBeLessThanOrEqual(121)
    expect(sentence?.endsWith('…')).toBe(true)
  })
})
