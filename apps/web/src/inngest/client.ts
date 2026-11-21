import { Inngest } from 'inngest'

/**
 * checkpoint の時間枠。Inngest は 1 回のリクエストの中で、この時間が経つまでは次のステップを続けて始める
 * （経ったら新しいステップは始めず、次のリクエストに回す。始めたステップは途中で止めない）。
 * SDK の初期値（serve では 10 秒）と同じだが、/api/inngest の maxDuration の計算に使うので明示する
 */
export const CHECKPOINT_MAX_RUNTIME_MS = 10_000

/**
 * Inngest のクライアント。イベントキー・署名キーは環境変数（INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY）から読む。
 * 手元では INNGEST_DEV=1 にすると、キーなしで開発サーバー（pnpm inngest:dev）につながる
 */
export const inngest = new Inngest({
  id: 'llmo-tracker',
  checkpointing: { maxRuntime: CHECKPOINT_MAX_RUNTIME_MS },
})
