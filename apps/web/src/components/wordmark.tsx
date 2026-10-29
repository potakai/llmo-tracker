import Link from 'next/link'

/** ロゴ：計測器の目盛りを模した記号＋名前 */
export function Wordmark({ href = '/' }: { href?: '/' | '/app' }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-bold text-ink">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <rect
          x="1"
          y="1"
          width="20"
          height="20"
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M5 16 L9 11 L12 13 L17 6"
          fill="none"
          stroke="var(--color-gemini)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="17"
          cy="6"
          r="2"
          fill="var(--color-own)"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
      LLMO Tracker
    </Link>
  )
}
