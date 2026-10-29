import { brand, competitor, createDb, organization, prompt } from '@llmo/db'
import { type AnswerProvider, createFakeProvider, type Providers } from '@llmo/llm'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL が設定されていません')
export const db = createDb(url)

/** 組織・ブランド・競合・質問をまとめて作る */
export async function seedBrand(options: { prompts?: string[]; samplesPerPrompt?: number } = {}) {
  const [org] = await db
    .insert(organization)
    .values({ name: 'Test', slug: `test-${crypto.randomUUID()}`, createdAt: new Date() })
    .returning()
  const [b] = await db
    .insert(brand)
    .values({
      organizationId: org!.id,
      name: '◯◯会計',
      domain: 'maru.example.com',
      samplesPerPrompt: options.samplesPerPrompt ?? 5,
    })
    .returning()
  await db.insert(competitor).values([
    { brandId: b!.id, name: '競合A' },
    { brandId: b!.id, name: '競合B' },
  ])
  const prompts = await db
    .insert(prompt)
    .values((options.prompts ?? ['質問1', '質問2']).map((text) => ({ brandId: b!.id, text })))
    .returning()
  return { brand: b!, prompts }
}

/** 呼ばれた回数を数えられるプロバイダー */
export function countingProviders(
  overrides: Partial<Record<'openai' | 'gemini', AnswerProvider>> = {},
) {
  const calls = { openai: 0, gemini: 0 }
  const wrap = (p: AnswerProvider): AnswerProvider => ({
    id: p.id,
    model: p.model,
    ask: (input) => {
      calls[p.id] += 1
      return p.ask(input)
    },
  })
  const providers: Providers = {
    openai: wrap(overrides.openai ?? createFakeProvider('openai')),
    gemini: wrap(overrides.gemini ?? createFakeProvider('gemini')),
  }
  return { providers, calls }
}
