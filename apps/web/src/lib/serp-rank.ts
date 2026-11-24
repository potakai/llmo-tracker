/** Google の順位のセルに出す状態 */
export type RankState =
  /** 競合のドメインが未設定 */
  | { kind: 'noDomain' }
  /** 結果を保存したあとに追加した競合など、その結果ではまだ照合していない */
  | { kind: 'notMeasured' }
  /** 照合したが、上位 10 位に入っていない */
  | { kind: 'outOfRange' }
  | { kind: 'ranked'; rank: number }

/**
 * 保存済みの検索結果の競合の順位（competitorRanks）から、セルに出す状態を決める。
 * キーがない＝その結果では照合していない（未計測）、キーがあって null＝圏外、と区別する
 */
export function competitorRankState(
  competitorRanks: Readonly<Record<string, number | null>>,
  competitor: { id: string; domain: string | null },
): RankState {
  if (!competitor.domain) return { kind: 'noDomain' }
  if (!Object.hasOwn(competitorRanks, competitor.id)) return { kind: 'notMeasured' }
  const rank = competitorRanks[competitor.id]
  return rank === null || rank === undefined ? { kind: 'outOfRange' } : { kind: 'ranked', rank }
}
