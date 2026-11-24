import { describe, expect, it } from 'vitest'
import { competitorRankState } from '@/lib/serp-rank'

describe('competitorRankState（Google の順位のセルに何を出すか）', () => {
  const ranks = { ranked: 3, outside: null }

  it('競合のドメインが未設定なら、結果があっても「ドメイン未設定」になる', () => {
    expect(competitorRankState(ranks, { id: 'ranked', domain: null })).toEqual({
      kind: 'noDomain',
    })
  })

  it('保存済みの結果にその競合のキーがなければ（結果のあとに追加した競合）、「未計測」になる', () => {
    expect(competitorRankState(ranks, { id: 'added-later', domain: 'later.example' })).toEqual({
      kind: 'notMeasured',
    })
  })

  it('キーがあって値が null なら、「圏外」になる', () => {
    expect(competitorRankState(ranks, { id: 'outside', domain: 'outside.example' })).toEqual({
      kind: 'outOfRange',
    })
  })

  it('順位があれば、その順位になる', () => {
    expect(competitorRankState(ranks, { id: 'ranked', domain: 'ranked.example' })).toEqual({
      kind: 'ranked',
      rank: 3,
    })
  })
})
