import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { normalize } from '../extract/rule-based'

/** packages/llm/eval/golden.json */
export const GOLDEN_SET_PATH = join(import.meta.dirname, '../../eval/golden.json')

const namedSchema = z.object({ name: z.string().min(1), aliases: z.array(z.string().min(1)) })

/** ExtractInput と同じ形（abortSignal を除く） */
const inputSchema = z.object({
  answerText: z.string().min(1),
  brand: namedSchema,
  competitors: z.array(namedSchema.extend({ id: z.string().min(1) })),
})

const expectedMentionSchema = z.object({
  entityType: z.enum(['brand', 'competitor', 'unknown']),
  competitorId: z.string().min(1).nullable(),
  /** 回答中の表記 */
  name: z.string().min(1),
})

const expectedSchema = z.object({
  brandMentioned: z.boolean(),
  brandRank: z.number().int().positive().nullable(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).nullable(),
  /** 登場順 */
  mentions: z.array(expectedMentionSchema),
})

type Issue = { path: (string | number)[]; message: string }

/** 正解ラベルの中で食い違いがないかを調べる（brandRank と mentions の位置など） */
function inconsistencies(c: {
  input: z.infer<typeof inputSchema>
  expected: z.infer<typeof expectedSchema>
}): Issue[] {
  const { input, expected } = c
  const competitorIds = new Set(input.competitors.map((comp) => comp.id))
  const issues: Issue[] = []
  const seen = new Set<string>()

  for (const [i, m] of expected.mentions.entries()) {
    const path = ['expected', 'mentions', i]
    if (
      m.entityType === 'competitor' &&
      (m.competitorId === null || !competitorIds.has(m.competitorId))
    ) {
      issues.push({
        path,
        message: `competitorId「${m.competitorId}」が input.competitors にありません`,
      })
    }
    if (m.entityType !== 'competitor' && m.competitorId !== null) {
      issues.push({ path, message: `${m.entityType} の competitorId は null にしてください` })
    }
    const key =
      m.entityType === 'unknown'
        ? `unknown:${normalize(m.name)}`
        : `${m.entityType}:${m.competitorId}`
    if (seen.has(key)) issues.push({ path, message: `同じ会社が2回あります（${m.name}）` })
    seen.add(key)
  }

  const brandIndex = expected.mentions.findIndex((m) => m.entityType === 'brand')
  if (expected.brandMentioned !== brandIndex >= 0) {
    issues.push({
      path: ['expected', 'brandMentioned'],
      message: 'mentions にブランドがあるかと合いません',
    })
  }
  if (expected.brandRank !== (brandIndex >= 0 ? brandIndex + 1 : null)) {
    issues.push({
      path: ['expected', 'brandRank'],
      message: 'mentions の中のブランドの位置と合いません',
    })
  }
  if ((expected.sentiment === null) === expected.brandMentioned) {
    issues.push({
      path: ['expected', 'sentiment'],
      message: 'sentiment は、ブランドが出てくるときだけ指定し、出てこなければ null にしてください',
    })
  }
  return issues
}

export const goldenCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'id は英小文字・数字・ハイフンで書いてください'),
    /** どのケースを確かめるためのものか */
    note: z.string().min(1),
    input: inputSchema,
    expected: expectedSchema,
  })
  .superRefine((c, ctx) => {
    for (const issue of inconsistencies(c)) ctx.addIssue({ code: 'custom', ...issue })
  })

export const goldenSetSchema = z.array(goldenCaseSchema).superRefine((cases, ctx) => {
  const seen = new Set<string>()
  for (const [i, c] of cases.entries()) {
    if (seen.has(c.id))
      ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `id「${c.id}」が重複しています` })
    seen.add(c.id)
  }
})

export type GoldenCase = z.infer<typeof goldenCaseSchema>
export type ExpectedExtraction = GoldenCase['expected']

/** ゴールデンセットを読み込み、スキーマで検証する。合わなければどこが違うかを書いたエラーを投げる */
export async function loadGoldenSet(path: string = GOLDEN_SET_PATH): Promise<GoldenCase[]> {
  const text = await readFile(path, 'utf8')
  const result = goldenSetSchema.safeParse(JSON.parse(text))
  if (!result.success) {
    throw new Error(
      `ゴールデンセット（${path}）が正しくありません:\n${z.prettifyError(result.error)}`,
    )
  }
  return result.data
}
