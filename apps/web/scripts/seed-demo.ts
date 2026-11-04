/**
 * デモ用のデータを作る：デモユーザー、組織、ブランド、30 日分の自動計測。
 *   pnpm db:seed
 * 何度実行しても、デモ組織のブランドを作り直すだけ（他のデータには触らない）。
 * 会社名とドメインはすべて架空（.example）。
 */
import { brand, competitor, member, organization, prompt, run, user } from '@llmo/db'
import { type AnswerProvider, createRuleBasedExtractor, type ProviderId } from '@llmo/llm'
import { createScheduledRun, executeRun } from '@llmo/runner'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { DEMO_ACCOUNT } from '@/lib/demo'
import { addDays, todayInTokyo } from '@/lib/stats'
import { DEMO_METADATA } from '@/server/demo'

const DAYS = 30
const BRAND = 'サンプル会計'
const COMPETITORS = ['ミライ会計', 'ラクラク帳簿']
const OTHERS = ['クラウドブックス', 'ベーシック帳簿']
const PROMPTS = [
  '中小企業向けのおすすめ会計ソフトは？',
  '個人事業主が使いやすいクラウド会計は？',
  'インボイス制度に対応した安い会計ソフトを教えて',
  '経理の経験がなくても使える会計ソフトは？',
]
const DOMAINS = [
  { url: 'https://hikaku-navi.example/kaikei', title: '会計ソフト比較ナビ' },
  { url: 'https://mirai-kaikei.example/', title: 'ミライ会計 公式' },
  { url: 'https://keiri-note.example/blog/cloud', title: '経理ノート' },
  { url: 'https://rakuraku-choubo.example/price', title: 'ラクラク帳簿 料金' },
]
const OWN = { url: 'https://sample-kaikei.example/features', title: 'サンプル会計 機能一覧' }

// --- 決まった乱数（同じ入力なら同じ結果） ---------------------------------
function rng(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * デモ用の AI。日が進むほど自社が出やすくなる（18 日目あたりで施策が効いた想定）。
 * ChatGPT のほうが先に反応し、Gemini は遅れて少しだけ上がる。
 */
function demoProvider(id: ProviderId, state: { day: number }): AnswerProvider {
  let calls = 0
  return {
    id,
    model: `demo-${id}`,
    async ask({ prompt: question }) {
      calls += 1
      const random = rng(`${id}:${question}:${state.day}:${calls}`)
      const t = state.day / (DAYS - 1)
      const boost = state.day >= 18 ? 0.15 : 0
      const pBrand = id === 'openai' ? 0.22 + 0.2 * t + boost : 0.12 + 0.12 * t + boost / 2

      const candidates: { name: string; weight: number }[] = [
        { name: COMPETITORS[0]!, weight: random() < 0.8 ? 3 + random() : 0 },
        { name: COMPETITORS[1]!, weight: random() < 0.55 ? 2 + random() : 0 },
        { name: BRAND, weight: random() < pBrand ? 1.5 + random() * (1 + t * 2) : 0 },
        { name: OTHERS[0]!, weight: random() < 0.3 ? 1 + random() : 0 },
        { name: OTHERS[1]!, weight: random() < 0.15 ? random() : 0 },
      ]
      const picked = candidates.filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight)
      const list = picked.length > 0 ? picked : [candidates[0]!]

      const text = [
        `「${question}」というご質問ですね。よく名前が挙がるものを紹介します。`,
        '',
        ...list.map(
          (c, i) =>
            `${i + 1}. ${c.name}：${['機能が充実', '価格が手ごろ', '画面がわかりやすい', 'サポートが丁寧'][i % 4]}と評判です。`,
        ),
        '',
        '無料体験で実際の画面を比べてみるのがおすすめです。',
      ].join('\n')

      const sources = [...DOMAINS].filter(() => random() < 0.5)
      if (list.some((c) => c.name === BRAND) && random() < 0.4 + t * 0.4) sources.push(OWN)

      return {
        provider: id,
        model: `demo-${id}`,
        text,
        sources,
        inputTokens: 40,
        outputTokens: text.length,
        searchCount: 1,
        latencyMs: Math.round(2000 + random() * 6000),
      }
    },
  }
}

async function main() {
  // 1. デモユーザー（なければ作る）
  let [demoUser] = await db.select().from(user).where(eq(user.email, DEMO_ACCOUNT.email))
  if (!demoUser) {
    await auth.api.signUpEmail({
      body: { name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
    })
    ;[demoUser] = await db.select().from(user).where(eq(user.email, DEMO_ACCOUNT.email))
  }
  if (!demoUser) throw new Error('デモユーザーを作れませんでした')

  // 2. 組織（なければ作る）
  let [membership] = await db.select().from(member).where(eq(member.userId, demoUser.id))
  if (!membership) {
    const [org] = await db
      .insert(organization)
      .values({
        name: 'デモ株式会社',
        slug: `demo-${crypto.randomUUID().slice(0, 8)}`,
        createdAt: new Date(),
      })
      .returning()
    ;[membership] = await db
      .insert(member)
      .values({
        organizationId: org!.id,
        userId: demoUser.id,
        role: 'owner',
        createdAt: new Date(),
      })
      .returning()
  }
  const organizationId = membership!.organizationId
  // デモ組織の目印（閲覧専用にするため）。既存の組織にも付け直す
  await db
    .update(organization)
    .set({ metadata: DEMO_METADATA })
    .where(eq(organization.id, organizationId))

  // 3. ブランドの中身を作り直す。ブランドの行は残して ID（＝ URL）を変えない
  //    （作り直すたびに URL が変わると、開いていたタブが 404 になるため）
  const existing = await db.select().from(brand).where(eq(brand.organizationId, organizationId))
  const [keep, ...extra] = existing
  for (const old of extra) await db.delete(brand).where(eq(brand.id, old.id))
  const values = {
    name: BRAND,
    aliases: [],
    domain: 'sample-kaikei.example',
    samplesPerPrompt: 5,
    providers: ['openai', 'gemini'] as ('openai' | 'gemini')[],
    scheduleEnabled: true,
  }
  let b: typeof brand.$inferSelect
  if (keep) {
    // run・回答・質問・競合は消してから入れ直す（回答などは cascade で消える）
    await db.delete(run).where(eq(run.brandId, keep.id))
    await db.delete(prompt).where(eq(prompt.brandId, keep.id))
    await db.delete(competitor).where(eq(competitor.brandId, keep.id))
    ;[b] = (await db.update(brand).set(values).where(eq(brand.id, keep.id)).returning()) as [
      typeof brand.$inferSelect,
    ]
  } else {
    ;[b] = (await db
      .insert(brand)
      .values({ organizationId, ...values })
      .returning()) as [typeof brand.$inferSelect]
  }
  await db.insert(competitor).values(COMPETITORS.map((name) => ({ brandId: b.id, name })))
  await db.insert(prompt).values(PROMPTS.map((text) => ({ brandId: b.id, text })))

  // 4. 30 日分の自動計測
  const state = { day: 0 }
  const providers = { openai: demoProvider('openai', state), gemini: demoProvider('gemini', state) }
  const extractor = createRuleBasedExtractor()
  const today = todayInTokyo()
  for (let day = 0; day < DAYS; day++) {
    state.day = day
    const date = addDays(today, day - (DAYS - 1))
    const created = await createScheduledRun(db, b.id, date)
    if (!created) continue
    await executeRun({ db, providers, extractor, concurrency: 8 }, created.id)
    process.stdout.write(`\r計測中… ${day + 1}/${DAYS} 日`)
  }

  console.log(`\n完了。${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password} でログインできます`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
