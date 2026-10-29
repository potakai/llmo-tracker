import Link from 'next/link'
import { HighlightedAnswer } from '@/components/highlighted-answer'
import { Wordmark } from '@/components/wordmark'

const SAMPLE_ANSWER = `中小企業におすすめのクラウド会計ソフトをいくつか挙げます。

1. ミライ会計：銀行明細の自動取り込みが充実しています。
2. サンプル会計：画面がシンプルで、はじめての経理担当者でも迷いにくいと評判です。
3. ラクラク帳簿：低価格で、個人事業主にも向いています。

ほかに、クラウドブックスも候補になります。`

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <header className="flex items-center justify-between py-6">
        <Wordmark />
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login" className="px-2 py-1 hover:underline">
            ログイン
          </Link>
          <Link href="/signup" className="btn-primary text-sm">
            無料で始める
          </Link>
        </nav>
      </header>

      <main className="grid gap-12 py-12 md:grid-cols-[1fr_1.1fr] md:items-center md:py-20">
        <section>
          <h1 className="text-3xl font-bold leading-snug md:text-[2.6rem] md:leading-[1.35]">
            ChatGPT に聞かれたとき、あなたの会社は名前を挙げてもらえていますか。
          </h1>
          <p className="mt-6 max-w-[34em] text-ink-soft">
            お客さんがしそうな質問を登録しておくと、ChatGPT と Gemini に毎日聞いて、
            自社と競合が何回・何番目に出てきたか、どのサイトが引用されたかを記録します。 AI
            検索対策（LLMO）の効果を、推移で確かめられます。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary">
              無料で始める
            </Link>
            <Link href="/login?demo=1" className="btn-quiet">
              デモアカウントで見る
            </Link>
          </div>
        </section>

        <figure className="panel p-6">
          <figcaption className="mb-4 text-sm text-ink-soft">
            「中小企業向けのおすすめ会計ソフトは？」への回答から、自社と競合を拾った例
          </figcaption>
          <div className="text-[0.95rem]">
            <HighlightedAnswer
              text={SAMPLE_ANSWER}
              marks={[
                { name: 'サンプル会計', entityType: 'brand' },
                { name: 'ミライ会計', entityType: 'competitor' },
                { name: 'ラクラク帳簿', entityType: 'competitor' },
                { name: 'クラウドブックス', entityType: 'unknown' },
              ]}
            />
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-rule pt-4 text-sm">
            <div>
              <dt className="text-ink-soft">自社の言及</dt>
              <dd className="font-bold">あり</dd>
            </div>
            <div>
              <dt className="text-ink-soft">登場順</dt>
              <dd className="num font-bold">2 番目</dd>
            </div>
            <div>
              <dt className="text-ink-soft">未登録の会社</dt>
              <dd className="font-bold">1 社</dd>
            </div>
          </dl>
        </figure>
      </main>

      <footer className="border-t border-rule py-8 text-sm text-ink-soft">
        数字は API
        経由の回答から出した目安です。アプリで見る回答は、人によって変わることがあります。
      </footer>
    </div>
  )
}
