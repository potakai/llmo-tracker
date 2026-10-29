import { execSync } from 'node:child_process'

/** デモアカウントのデータを作り直しておく（何度実行しても同じ状態になる） */
export default function globalSetup() {
  execSync('pnpm db:seed', { stdio: 'inherit' })
}
