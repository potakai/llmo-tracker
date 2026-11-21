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
| ジョブ        | Inngest（毎日の自動実行、リトライ、止まった実行の回収）     |
| 画面          | Tailwind CSS 4 / Recharts                                   |
| Lint / Format | Biome                                                       |
| テスト        | Vitest（実DBを使った結合テスト）/ Playwright（E2E）         |

## ディレクトリ構成

```
apps/
  web/            Next.js アプリ（画面・API・認証）
    src/server/   Hono の API（ルート、ミドルウェア、Zod スキーマ）
    src/inngest/  Inngest の関数（run の実行、毎日の自動実行、止まった run の回収）。/api/inngest で公開
    test/         結合テスト
packages/
  llm/            AI ごとの呼び出し（OpenAI / Gemini / フェイク）、回答の抽出、料金の計算
  runner/         実行バッチ（run）の処理：AI に聞いて回答と引用元を保存し、言及を抽出する。毎日の run の作成と、止まった run の回収も
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
| `pnpm inngest:dev`                 | Inngest の開発サーバーを立てる（http://localhost:8288）。手元で Inngest の関数を動かすとき（下を参照）                 |
| `pnpm lint` / `pnpm format`        | Biome でチェック / 自動修正                                                                                            |

### 手元で Inngest の関数を動かす

`RUN_DISPATCH` が未設定なら、「今すぐ計測」は Next.js と同じプロセスで動く（Inngest は不要）。本番と同じく Inngest を通して動かしたいときは：

1. `.env` に `RUN_DISPATCH=inngest` と `INNGEST_DEV=1` を入れる（キーは不要）
2. `pnpm dev` と `pnpm inngest:dev` を別々のターミナルで立ち上げる
3. 画面で「今すぐ計測」を押し、http://localhost:8288 の Runs で `execute-run` が `slice-1`、`slice-2`… とステップに分かれて進むのを見る。`daily-runs` / `recover-stale-runs` は Functions の画面から Invoke で手で起動できる

## 設計判断

- **テナントの境界は `brand.organization_id`**：アプリのデータはすべて brand をたどって組織にひもづく
- **リトライしても壊れない**：`response` は (run, prompt, provider, sample_index) で一意。自動実行の `run` は (brand, 日付) で一意。ジョブが再実行されても重複しない
- **取得と分析を分ける**：生の回答（`response`）と解釈（`analysis` / `mention`）を別テーブルにして、抽出ロジックを直したら過去の回答を API を叩き直さずに再分析できる
- **ルールは DB の制約でも守る**：サンプル数の範囲、成功時は本文必須、自動実行と日付の対応などを CHECK 制約にしている
- **他の組織のデータは 404**：存在するかどうかも漏らさない。テナントの絞り込みを外すとテストが落ちることを確認済み
- **AI は差し替えられる**：OpenAI・Gemini・フェイクが同じインターフェース（`AnswerProvider`）を実装している。AI を足すときは 1 ファイル足すだけ。開発・テスト・公開デモはフェイクで動くので費用がかからない（`LLM_MODE=live` のときだけ本物を叩く）
- **本物の AI を使うのは許可した組織だけ**：公開版は誰でもサインアップしてブランドを登録できる。そのまま本物の AI で毎日計測すると、知らない人の分まで API の費用がかかる。そこで `LLM_MODE=live` に加えて、環境変数 `LIVE_ORGANIZATION_IDS` にある組織だけを本物の AI で計測し、それ以外はフェイクで計測する（画面にもその旨を出す）。許可の一覧は組織の `metadata` には置かない（ユーザーが Better Auth の API で書き換えられるため）。一覧が空なら全組織がフェイクになるので、設定し忘れても課金されない
- **実行は途中から再開できる**：成功済みの回答は聞き直さず、失敗した分だけ聞き直す。1 ブランドで同時に動く実行は 1 つまで（DB の部分ユニークインデックスで保証）
- **実行は時間で区切って少しずつ進める**：本物の AI だと 1 つの run に数分かかり、サーバーレス関数（Vercel）の実行時間の上限を超える。そこで `executeRunSlice` に予算（`budgetMs`）を渡し、使い切ったら新しい質問・抽出を始めずに `{ done: false }` を返す。残りは毎回 DB から数え直すので、何度に分けて呼んでも、途中で落ちても続きから進む。失敗した回答は、その通しを始める前に失敗したものだけ聞き直す（失敗し続ける AI があっても終わるように）。開発用の `executeRun` は、これを終わるまで呼ぶだけ
- **ジョブの投げ先は注入する**：開発はリクエストのあとに同じプロセスで実行、テストはその場で実行、本番は Inngest に `run/requested` イベントを送る（`RUN_DISPATCH=inngest`）
- **ジョブは Inngest で、Vercel の関数として動かす**：Inngest の関数は `apps/web` に置き、`/api/inngest` で公開する。Inngest がステップごとに HTTP で呼びに来るので、別のワーカーを立てたりデプロイしたりしなくてよい。`execute-run` は `executeRunSlice` を 1 ステップ 45 秒の予算で `done` になるまで呼ぶ（投げ途中の質問を待つ分も含めて収まるよう、`/api/inngest` の `maxDuration` は 300 秒）。同じ run が同時に 2 つ動かないよう `concurrency` の key を run の ID にし、全体でも 3 つまで（Hobby プランの上限 5 より小さく）。リトライを使い切ったら `onFailure` で run を終わらせる
- **Trigger.dev から Inngest に乗り換えた**：最初は Trigger.dev を使っていたが、新しい組織では本番へのデプロイができなくなった（`Deployments are not available for this organization`）。Inngest はアプリと同じ Vercel にデプロイされた関数を呼ぶ形なので、ジョブ用のデプロイが要らない。ジョブの中身（run の処理・毎日の run の作成・回収）は最初から `packages/runner` に置き、テストも runner 側にあったので、乗り換えで書き直したのは runner を呼ぶ薄い部分（関数の定義と、Web からの投げ方）だけだった
- **毎日の自動実行は「作る」と「渡す」を分ける**：毎朝 6 時（日本時間）に、ブランドごとにその日の run を作り（DB の一意制約で 1 日 1 つ）、まだ `queued` の run をすべてジョブに渡す。run を作ったあとジョブに渡す前に落ちても、リトライで拾い直せる。イベントの ID を `run-<runId>` にしているので、同じ run を二重に渡しても（Web からも同じ ID）1 回しか動かない。デモ組織は対象外
- **止まった run は回収する**：10 分ごとに、30 分なにも進んでいない（作成・開始・回答の保存・分析のどれも更新がない）`queued` / `running` の run を終わらせる。成功した回答があれば `partial`、なければ `failed`。判定と更新を 1 つの UPDATE で行うので、回収の直前に進んだ run を誤って終わらせない。ジョブがリトライを使い切ったときと、ジョブに渡せなかったときは、30 分待たずにその場で終わらせる
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

- [x] **止まった実行が残る**：実行中にサーバーが落ちると run が `queued` / `running` のまま残り、そのブランドが実行できなくなっていた。ジョブ基盤（いまは Inngest）に移し、リトライ・失敗時の後始末・10 分ごとの回収を入れた。開発用の実行方式（`RUN_DISPATCH` 未設定）では回収の関数が動かないので、手元で止まった run は `pnpm inngest:dev` の画面から `recover-stale-runs` を起動するか、DB を直接直す
- [ ] **Next.js の typedRoutes を無効にしている**：TypeScript 7 だと、Next.js 16 が生成するルートの型（`RouteImpl`）で正しいパスまでエラーになる（TypeScript 6 では通ることを確認済み）。Next.js か TypeScript 側で直ったら `next.config.ts` で有効に戻す
- [ ] **`pnpm audit` に moderate が残っている**：inngest が読み込む OpenTelemetry の古い依存（`gaxios > rimraf > glob / minimatch`）と、drizzle-kit の esbuild。どれも開発時・内部での利用で、外からの入力は通らない。上流が更新したら上げる
