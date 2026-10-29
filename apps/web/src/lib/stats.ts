/**
 * 割合の 95% 信頼区間（Wilson スコア区間）。
 * 「n 回中 k 回言及された」から、本当の言及率がだいたいどの範囲にあるかを出す。
 * 正規近似（p ± 1.96√(p(1-p)/n)）と違って、n が小さいときや 0% / 100% 付近でも 0〜1 の外にはみ出さない。
 */
export function wilsonInterval(successes: number, total: number, z = 1.96) {
  if (total === 0) return { rate: null, low: null, high: null }
  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator
  return {
    rate: p,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  }
}

/** 'YYYY-MM-DD' に日数を足す（タイムゾーンの影響を受けないよう UTC で計算） */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 今日の日付（日本時間）を 'YYYY-MM-DD' で */
export function todayInTokyo(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now)
}
