# LLMO Tracker

ChatGPT や Gemini に毎日同じ質問を投げて、自社と競合が回答の中でどう扱われているか（言及率・順位・引用元）を計測するツール。

> 開発中（v1）

## 技術スタック

| 役割          | 技術                                                        |
| ------------- | ----------------------------------------------------------- |
| 言語          | TypeScript 7                                                |
| 構成          | pnpm workspaces のモノレポ                                  |
| フロント      | Next.js 16（App Router）/ React 19                          |
| API           | Hono（Next.js の Route Handler 上で動かす）                 |
| DB            | PostgreSQL 18 + Drizzle ORM                                 |
| 認証          | Better Auth（organization プラグインでマルチテナント）      |
| LLM           | Vercel AI SDK（OpenAI の Web 検索 / Gemini の Google 検索） |
| ジョブ        | Trigger.dev（予定）                                         |
| Lint / Format | Biome                                                       |
| テスト        | Vitest（実DBを使った結合テスト）                            |

## ディレクトリ構成

```
apps/
  web/            Next.js アプリ（画面・API・認証）
    src/server/   Hono の API（ルート、ミドルウェア、Zod スキーマ）
    test/         結合テスト
packages/
  llm/            AI ごとの呼び出し（OpenAI / Gemini / フェイク）と料金の計算
  runner/         実行バッチ（run）の処理：AI に聞いて回答と引用元を保存する
  db/             Drizzle のスキーマ、DBクライアント、マイグレーション
    src/schema/
      app.ts      アプリのテーブル（brand, prompt, run, response など）
      auth.ts     Better Auth が生成するテーブル（手で編集しない）
    drizzle/      生成された SQL マイグレーション
```

## セットアップ

必要なもの：Node.js 22 以上、pnpm（`corepack enable` で入る）、Docker

1. `.env` を作り、`BETTER_AUTH_SECRET` に `openssl rand -base64 32` の結果を入れる
2. Docker Desktop を起動しておく
3. 次を実行して http://localhost:3000 を開く

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm test
pnpm dev
```

## よく使うコマンド

| コマンド                           | 内容                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `pnpm db:generate`                 | スキーマの変更から SQL マイグレーションを作る                              |
| `pnpm db:migrate`                  | マイグレーションを DB に適用する                                           |
| `pnpm db:studio`                   | Drizzle Studio で DB の中身を見る                                          |
| `pnpm auth:generate`               | Better Auth の設定からテーブル定義（`auth.ts`）を作り直す                  |
| `pnpm ask "質問" [openai\|gemini]` | 本物の API に 1 回だけ聞いて、回答・引用元・費用を表示（API キーの確認用） |
| `pnpm test`                        | 結合テスト（テスト用DBを作り直してから流す）                               |
| `pnpm typecheck`                   | 全パッケージの型チェック                                                   |
| `pnpm lint` / `pnpm format`        | Biome でチェック / 自動修正                                                |

## 設計判断

- **テナントの境界は `brand.organization_id`**：アプリのデータはすべて brand をたどって組織にひもづく
- **リトライしても壊れない**：`response` は (run, prompt, provider, sample_index) で一意。自動実行の `run` は (brand, 日付) で一意。ジョブが再実行されても重複しない
- **取得と分析を分ける**：生の回答（`response`）と解釈（`analysis` / `mention`）を別テーブルにして、抽出ロジックを直したら過去の回答を API を叩き直さずに再分析できる
- **ルールは DB の制約でも守る**：サンプル数の範囲、成功時は本文必須、自動実行と日付の対応などを CHECK 制約にしている
- **他の組織のデータは 404**：存在するかどうかも漏らさない。テナントの絞り込みを外すとテストが落ちることを確認済み
- **AI は差し替えられる**：OpenAI・Gemini・フェイクが同じインターフェース（`AnswerProvider`）を実装している。AI を足すときは 1 ファイル足すだけ。開発・テスト・公開デモはフェイクで動くので費用がかからない（`LLM_MODE=live` のときだけ本物を叩く）
- **実行は途中から再開できる**：成功済みの回答は聞き直さず、失敗した分だけ聞き直す。1 ブランドで同時に動く実行は 1 つまで（DB の部分ユニークインデックスで保証）
- **ジョブの投げ先は注入する**：開発はリクエストのあとに同じプロセスで実行、テストはその場で実行、本番は Trigger.dev（予定）
- **id は UUIDv7**：時刻順に並ぶので、作成順の並び替えやインデックスと相性がいい

## 計測の限界

- API 経由の回答は、ユーザーがアプリで見る回答（検索の有無、メモリ、パーソナライズで変わる）と完全には一致しない。数字は傾向を見るための「基準値」として扱う
- 同じ質問でも回答は毎回ぶれるため、1回の実行で同じ質問を複数回聞き（初期値5回）、直近7日分をまとめて割合と誤差の幅で表示する
