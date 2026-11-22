import { describe, expect, it } from 'vitest'
import { findNegativePassage } from '@/lib/hint-quotes'

const BRAND = ['サンプル会計', 'SK']
const OTHERS = ['ミライ会計', 'ラクラク帳簿']

describe('自社について否定的に書いている箇所', () => {
  it('社名の文に否定的な言い回しがあれば、その文を前後の文とあわせて返す', () => {
    const text =
      '会計ソフトを比べました。\n1. サンプル会計：設定が難しいという声もあります。\n2. ミライ会計：人気です。'
    expect(findNegativePassage(text, BRAND, OTHERS)).toEqual({
      before: '会計ソフトを比べました。',
      focus: 'サンプル会計：設定が難しいという声もあります。',
      after: 'ミライ会計：人気です。',
    })
  })

  it('社名が最初に出てくる文が否定的でなければ、あとの文から探す（最初の文だけを見ない）', () => {
    const text =
      'サンプル会計はクラウド型です。料金も手ごろです。一方で、サンプル会計はサポートの返信が遅いという指摘があります。'
    expect(findNegativePassage(text, BRAND, OTHERS)?.focus).toBe(
      '一方で、サンプル会計はサポートの返信が遅いという指摘があります。',
    )
  })

  it('社名の文のすぐ次の文に否定的な言い回しがあれば、その文を返す', () => {
    const text =
      'サンプル会計は機能が多いです。ただし、初心者には使いにくいかもしれません。以上です。'
    expect(findNegativePassage(text, BRAND, OTHERS)).toEqual({
      before: 'サンプル会計は機能が多いです。',
      focus: 'ただし、初心者には使いにくいかもしれません。',
      after: '以上です。',
    })
  })

  it('隣の文がほかの会社についての否定的な文なら、自社のこととはみなさない', () => {
    const text = 'サンプル会計は機能が多いです。\nミライ会計は動作が遅いとの声もあります。'
    expect(findNegativePassage(text, BRAND, OTHERS)).toBeNull()
  })

  it('表記ゆれ・別名の社名でも見つける', () => {
    expect(findNegativePassage('さんぷる会計は割高です。', BRAND, OTHERS)?.focus).toBe(
      'さんぷる会計は割高です。',
    )
    expect(findNegativePassage('ＳＫ は不便です。', BRAND, OTHERS)?.focus).toBe('ＳＫ は不便です。')
  })

  it('否定的な言い回しが見つからなければ null（回答全体を見てもらう）', () => {
    expect(findNegativePassage('サンプル会計はクラウド型です。', BRAND, OTHERS)).toBeNull()
  })

  it('長すぎる文は切り詰める', () => {
    const passage = findNegativePassage(`サンプル会計は${'あ'.repeat(300)}遅い。`, BRAND, OTHERS)
    expect(passage?.focus.length).toBeLessThanOrEqual(121)
    expect(passage?.focus.endsWith('…')).toBe(true)
  })
})
