import { Inngest } from 'inngest'

/**
 * Inngest のクライアント。イベントキー・署名キーは環境変数（INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY）から読む。
 * 手元では INNGEST_DEV=1 にすると、キーなしで開発サーバー（npx inngest-cli dev）につながる
 */
export const inngest = new Inngest({ id: 'llmo-tracker' })
