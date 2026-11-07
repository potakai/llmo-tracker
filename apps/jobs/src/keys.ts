import { idempotencyKeys } from '@trigger.dev/sdk'

/**
 * 同じ run を二重にジョブにしないための鍵。Web（手動実行）からも自動実行からも同じものを使う。
 * Web から読み込まれるので、タスクの中身（DB・AI）には依存させない
 */
export const executeRunKey = (runId: string) =>
  idempotencyKeys.create(`execute-run:${runId}`, { scope: 'global' })

/** execute-run タスクの ID */
export const EXECUTE_RUN_TASK_ID = 'execute-run'
