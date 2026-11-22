import { PROMPT_KINDS, PROVIDERS } from '@llmo/db'
import { z } from 'zod'

/** 1ブランドで有効にできる質問の上限 */
export const MAX_ACTIVE_PROMPTS = 10
export const MAX_COMPETITORS = 10

/**
 * 「https://www.example.com/about」→「example.com」のように、ホスト名だけにそろえる。
 * 引用URLとの突き合わせでブレないようにするため。
 */
export function normalizeDomain(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const domainSchema = z
  .string()
  .trim()
  .transform(normalizeDomain)
  .pipe(
    z.string().regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, {
      error: 'ドメインの形式が正しくありません',
    }),
  )

const nameSchema = z.string().trim().min(1, { error: '必須です' }).max(100)
const aliasesSchema = z.array(nameSchema).max(10).default([])

const hasNoDuplicates = (values: string[]) =>
  new Set(values.map((v) => v.toLowerCase())).size === values.length

export const competitorInput = z.object({
  name: nameSchema,
  aliases: aliasesSchema,
  domain: domainSchema.optional(),
})

export const promptText = z.string().trim().min(1, { error: '必須です' }).max(500)

export const promptKind = z.enum(PROMPT_KINDS, { error: '質問の種類が正しくありません' })

/** ブランドの登録で渡す質問。文字列だけなら質問文（question）として扱う */
const brandPromptInput = z.union([
  promptText.transform((text) => ({ text, kind: 'question' as const })),
  z.object({ text: promptText, kind: promptKind.default('question') }),
])

export const createBrandInput = z.object({
  name: nameSchema,
  aliases: aliasesSchema,
  domain: domainSchema.optional(),
  competitors: z
    .array(competitorInput)
    .max(MAX_COMPETITORS, { error: `競合は${MAX_COMPETITORS}社までです` })
    .default([])
    .refine((list) => hasNoDuplicates(list.map((c) => c.name)), {
      error: '同じ名前の競合が重複しています',
    }),
  prompts: z
    .array(brandPromptInput)
    .min(1, { error: '質問を1つ以上登録してください' })
    .max(MAX_ACTIVE_PROMPTS, { error: `質問は${MAX_ACTIVE_PROMPTS}件までです` })
    .refine((list) => hasNoDuplicates(list.map((p) => p.text)), {
      error: '同じ質問が重複しています',
    }),
  samplesPerPrompt: z.int().min(1).max(10).default(5),
  providers: z
    .array(z.enum(PROVIDERS))
    .min(1, { error: '対象のAIを1つ以上選んでください' })
    .default([...PROVIDERS])
    .refine(hasNoDuplicates, { error: '対象のAIが重複しています' }),
})

export type CreateBrandInput = z.infer<typeof createBrandInput>

export const brandParams = z.object({
  brandId: z.uuid({ error: 'ブランドIDの形式が正しくありません' }),
})

export const runParams = brandParams.extend({
  runId: z.uuid({ error: '実行IDの形式が正しくありません' }),
})

/** ブランド情報の更新。送った項目だけ変える */
export const updateBrandInput = z
  .object({
    name: nameSchema,
    aliases: z.array(nameSchema).max(10),
    domain: domainSchema.nullable(),
    samplesPerPrompt: z.int().min(1).max(10),
    providers: z
      .array(z.enum(PROVIDERS))
      .min(1, { error: '対象のAIを1つ以上選んでください' })
      .refine(hasNoDuplicates, { error: '対象のAIが重複しています' }),
    scheduleEnabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: '変更する項目がありません' })

export const updateCompetitorInput = competitorInput
  .extend({ domain: domainSchema.nullable() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: '変更する項目がありません' })

export const createPromptInput = z.object({
  text: promptText,
  kind: promptKind.default('question'),
})

/**
 * 質問の変更。文面は変えられない（変えると過去の計測と比べられなくなる）ので、種類だけ。
 * text などほかの項目が付いていたら黙って捨てずに 400 にする（文面が変わったと誤解させない）
 */
export const updatePromptInput = z.strictObject({ kind: promptKind })

export const competitorParams = brandParams.extend({
  competitorId: z.uuid({ error: '競合IDの形式が正しくありません' }),
})

export const promptParams = brandParams.extend({
  promptId: z.uuid({ error: '質問IDの形式が正しくありません' }),
})

/** ダッシュボードの絞り込み。画面の URL（days / ai / kind / q）と API の両方で使う */
export const metricsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 30, 90].includes(d), { error: '期間は 7・30・90 日から選んでください' })
    .default(30),
  ai: z.enum(PROVIDERS).optional(),
  kind: promptKind.optional(),
  q: z.uuid().optional(),
})
export type MetricsQuery = z.infer<typeof metricsQuery>
