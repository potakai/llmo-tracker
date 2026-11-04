# LLMO Tracker

[![CI](https://github.com/potakai/llmo-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/potakai/llmo-tracker/actions/workflows/ci.yml)

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
| 画面          | Tailwind CSS 4 / Recharts                                   |
| Lint / Format | Biome                                                       |
| テスト        | Vitest（実DBを使った結合テスト）/ Playwright（E2E）         |

## ディレクトリ構成

```
apps/
  web/            Next.js アプリ（画面・API・認証）
    src/server/   Hono の API（ルート、ミドルウェア、Zod スキーマ）
    test/         結合テスト
packages/
  llm/            AI ごとの呼び出し（OpenAI / Gemini / フェイク）、回答の抽出、料金の計算
  runner/         実行バッチ（run）の処理：AI に聞いて回答と引用元を保存し、言及を抽出する
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
pnpm db:seed
pnpm dev
```

`pnpm db:seed` で、30 日分のサンプルデータを持つデモアカウントができます（トップの「デモアカウントで見る」からログイン）。会社名・ドメインはすべて架空です。

## よく使うコマンド

| コマンド                           | 内容                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:generate`                 | スキーマの変更から SQL マイグレーションを作る                                                                          |
| `pnpm db:migrate`                  | マイグレーションを DB に適用する                                                                                       |
| `pnpm db:studio`                   | Drizzle Studio で DB の中身を見る                                                                                      |
| `pnpm auth:generate`               | Better Auth の設定からテーブル定義（`auth.ts`）を作り直す                                                              |
| `pnpm ask "質問" [openai\|gemini]` | 本物の API に 1 回だけ聞いて、回答・引用元・費用を表示（API キーの確認用）                                             |
| `pnpm db:seed`                     | デモアカウントと 30 日分のサンプルデータを作る（何度実行しても作り直すだけ）                                           |
| `pnpm test`                        | 結合テスト（テスト用DBを作り直してから流す）                                                                           |
| `pnpm test:e2e`                    | ブラウザで画面を通しで確かめる（`pnpm dev` を自動で起動。初回は `pnpm --filter web exec playwright install chromium`） |
| `pnpm typecheck`                   | 全パッケージの型チェック                                                                                               |
| `pnpm lint` / `pnpm format`        | Biome でチェック / 自動修正                                                                                            |

## 設計判断

- **テナントの境界は `brand.organization_id`**：アプリのデータはすべて brand をたどって組織にひもづく
- **リトライしても壊れない**：`response` は (run, prompt, provider, sample_index) で一意。自動実行の `run` は (brand, 日付) で一意。ジョブが再実行されても重複しない
- **取得と分析を分ける**：生の回答（`response`）と解釈（`analysis` / `mention`）を別テーブルにして、抽出ロジックを直したら過去の回答を API を叩き直さずに再分析できる
- **ルールは DB の制約でも守る**：サンプル数の範囲、成功時は本文必須、自動実行と日付の対応などを CHECK 制約にしている
- **他の組織のデータは 404**：存在するかどうかも漏らさない。テナントの絞り込みを外すとテストが落ちることを確認済み
- **AI は差し替えられる**：OpenAI・Gemini・フェイクが同じインターフェース（`AnswerProvider`）を実装している。AI を足すときは 1 ファイル足すだけ。開発・テスト・公開デモはフェイクで動くので費用がかからない（`LLM_MODE=live` のときだけ本物を叩く）
- **実行は途中から再開できる**：成功済みの回答は聞き直さず、失敗した分だけ聞き直す。1 ブランドで同時に動く実行は 1 つまで（DB の部分ユニークインデックスで保証）
- **ジョブの投げ先は注入する**：開発はリクエストのあとに同じプロセスで実行、テストはその場で実行、本番は Trigger.dev（予定）
- **抽出は「LLM ＋ 名前のマッチング」の二段構え**：LLM が回答から会社名を登場順に抜き出し（Zod のスキーマで形を検証）、登録済みの名前・別名と突き合わせて自社・競合・未登録に振り分ける。LLM が拾い漏らした登録済みの名前は文字列マッチで補う。LLM が失敗したり形の違う JSON を返したりしたら、ルールベースにフォールバックする
- **言及率は幅で見せる**：日ごとの回答数は少ないので、直近 7 日分をまとめた割合と、Wilson の 95% 信頼区間を表示する（n が小さくても 0〜100% からはみ出さない）
- **デモは閲覧専用**：デモ組織（`organization.metadata` に目印）では、`/api/brands` 以下の GET 以外と、Better Auth の組織作成・パスワード変更などをすべて 403 にする。公開デモで誰かが計測を押して課金が発生することがない。画面でもボタンを無効にして理由を出す
- **絞り込みは URL に持つ**：期間・AI・質問は `?days=90&ai=gemini&q=...` に入るので、リンクを共有しても同じ画面になる。期間と AI はただのリンクなので JavaScript なしでも動き、キーボードでたどれる
- **質問の文面は書き換えさせない**：変えると過去の計測と比べられなくなるため、アーカイブして新しく追加する形にしている。有効な質問の上限（10 個）は、同時に追加されても超えないようブランドの行をロックしてから数える（同時に 12 件送っても 10 件で止まることをテストで確認）
- **`.env` はモノレポのルートに 1 つ**：Next.js（`next.config.ts`）、Drizzle、テスト、スクリプトのすべてがルートの `.env` を読む。Next.js は標準では `apps/web/.env` しか読まないため、`next.config.ts` で明示的に読み込んでいる（これが抜けてログインできなかったことがあり、E2E テストで検出できるようにした）
- **CI は本番と同じ形で E2E を流す**：GitHub Actions で Lint・型チェック・結合テスト（実 DB）・ビルドに加え、ビルドしたアプリを `next start` で立ち上げて E2E を流す。スキーマを変えたのにマイグレーションを作り忘れた場合も落ちる。`pnpm dev` では効かないログインの試行回数の制限（10 秒に 3 回）に、CI で初めて気づけた
- **id は UUIDv7**：時刻順に並ぶので、作成順の並び替えやインデックスと相性がいい

## 計測の限界

- API 経由の回答は、ユーザーがアプリで見る回答（検索の有無、メモリ、パーソナライズで変わる）と完全には一致しない。数字は傾向を見るための「基準値」として扱う
- 同じ質問でも回答は毎回ぶれるため、1回の実行で同じ質問を複数回聞き（初期値5回）、直近7日分をまとめて割合と誤差の幅で表示する

## 既知の課題

- [ ] **開発用の実行方式では、止まった実行が残る**：今は run をリクエストのあとに同じプロセスで実行している（`dispatchInProcess`）。実行中にサーバーが落ちると、run が `queued` / `running` のまま残り、「1 ブランドで同時に動く実行は 1 つまで」の制約によってそのブランドが実行できなくなる。本番用に Trigger.dev へ移すときに、リトライと「一定時間動いていない run の回収」をまとめて入れる
- [ ] **Next.js の typedRoutes を無効にしている**：TypeScript 7 だと、Next.js 16 が生成するルートの型（`RouteImpl`）で正しいパスまでエラーになる（TypeScript 6 では通ることを確認済み）。Next.js か TypeScript 側で直ったら `next.config.ts` で有効に戻す
