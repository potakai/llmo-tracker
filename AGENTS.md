# AGENTS.md

コーディングエージェント（Claude Code / Codex など）向けの、このリポジトリの約束ごと。人向けの説明は README.md。

## 概要

ChatGPT / Gemini に登録した質問を毎日投げ、回答の中で自社と競合がどう扱われているか（言及率・順位・引用元）を計測する。pnpm workspaces のモノレポ。

- `apps/web`：Next.js 16（App Router）。API は Hono を Route Handler に載せている（`src/server/`）。認証は Better Auth
- `packages/db`：Drizzle のスキーマ・マイグレーション
- `packages/llm`：AI の呼び出し（OpenAI / Gemini / フェイク）と、回答からの言及の抽出
- `packages/runner`：実行（run）の作成と処理、毎日の run の作成、止まった run の回収
- `apps/jobs`：Trigger.dev のタスク。中身は `packages/runner` を呼ぶだけにして、ロジックとテストは runner に置く

## コマンド

```bash
pnpm db:up          # Postgres を起動（Docker）
pnpm db:migrate     # マイグレーションを適用
pnpm dev            # http://localhost:3000
pnpm lint           # Biome。直すときは pnpm format
pnpm typecheck      # 全パッケージ
pnpm test           # 結合テスト（実 DB）
pnpm test:e2e       # Playwright
```

変更したら最低でも `pnpm lint && pnpm typecheck && pnpm test` を通す。画面を変えたら `pnpm test:e2e` も。CI（`.github/workflows/ci.yml`）も同じものを流す。

## 守ること

- **テナントの境界は `brand.organization_id`**。アプリのデータを読む・書くクエリは、必ず brand をたどって組織で絞る。他の組織のデータは 403 ではなく 404 を返す（存在を漏らさない）
- **デモ組織は閲覧専用**。書き込みの API を足したら、デモで 403 になることを確かめる（`apps/web/src/server/middleware/auth.ts` の `blockDemoWrites`）
- **スキーマを変えたら `pnpm db:generate` でマイグレーションを作り、`packages/db/drizzle/` ごとコミット**する。生成された SQL は手で書き換えない（既存のデータを直す必要があるときだけ、SQL の先頭に追記して理由をコメントする）
- `packages/db/src/schema/auth.ts` は Better Auth の生成物。手で編集せず `pnpm auth:generate` で作り直す
- **本物の AI API は叩かない**。開発・テストは `LLM_MODE=fake`。`LLM_MODE=live` や `pnpm ask` は費用がかかるので、人に頼まれたときだけ
- AI のプロバイダーや抽出器を新しく使う場所では、`createProvidersFromEnv` を直接呼ばず `createLlmPolicy(env).llmFor(organizationId)` を通す（本物の AI は `LIVE_ORGANIZATION_IDS` の組織だけ）
- 質問（prompt）の文面は書き換えない設計。変えたいときはアーカイブして新しく追加する
- 環境変数はルートの `.env` に 1 つ（`apps/web/.env` は作らない）。足したら `.env.example` と CI にも足す。Trigger.dev のタスクが使う変数は、Trigger.dev のダッシュボードにも設定が必要
- Web（`apps/web`）から `jobs` を読み込むときは、タスクの型（`import type`）と `src/keys.ts` だけにする。タスク本体を読み込むと DB・AI のコードが Next.js に入る
- `pnpm jobs:deploy` は本番に出るので、人に頼まれたときだけ
- エラーは `src/server/errors.ts` の `errors` から投げ、フロントは `code` で分岐する
- バグを直すときは、先に落ちるテストを書く

## 並列で作業するとき（git worktree など）

- `.env` は git に入っていないので、新しい worktree にはルートの `.env` をコピーする
- Postgres は 1 台を共有している。**`pnpm test` は毎回テスト用 DB（`llmo_test`）を作り直すので、同時に 2 つ流さない**。E2E も開発用 DB のデモデータを作り直すので同様
- `pnpm dev` を 2 つ立ち上げると 2 つ目は 3001 番になる。ログインは 3000〜3010 番を許可してある

## E2E

- CI では `next start`（本番モード）に対して流す。本番モードではログインに試行回数の制限（10 秒に 3 回）がかかるので、ログイン済みの画面を見るテストは `e2e/demo.setup.ts` が保存したログイン状態（`storageState`）を使い、毎回ログインし直さない

## 書き方

- コメント・テスト名・UI の文言は日本語。テスト名は「〜すると、〜になる」のように振る舞いで書く
- フォーマットは Biome に任せる（シングルクォート、セミコロンなし、幅 100）
- Next.js 16 は学習データと違うところがある。迷ったら `apps/web/AGENTS.md` の案内どおり `node_modules/next/dist/docs/` を読む
