# 新エリー都の一生

ゼンレスゾーンゼロの世界観を借りた非公式ファン作品の人生シミュレーション。
ここには書き方と変更の作法だけを置く。ほかは次を読む（変更する前に、関係するものを読む）。

- `docs/overview.md`：概要・ファイル・開発用の URL
- `docs/sim.md`：シミュレーションの構成と決まり（決断・選択肢の ID・運命・hooks）
- `docs/fall.md`：旧都陥落の演出
- `docs/setting.md`：方針（公式の扱い・ネタバレ）と、時代・場所の設定
- `docs/world.md` / `docs/schema.md`：lab の世界と道の仕組み / 表
- やることは GitHub の issue

## コーディングスタイル（Fossil に寄せる）
Fossil の「Coding Style」（https://fossil-scm.org/home/doc/trunk/www/style.wiki）に寄せる。
- 1行は表示幅80桁まで（全角は2桁）。例外は、途中で切ると grep で探せなくなるもの：URL、画面に出す日本語の文章、
  HTML や SVG のタグを含む行（Fossil の @ 行の HTML の例外にならう）
- タブを使わない。字下げは2桁。改行は `\n` だけ。行末に空白を残さない。ファイルは改行で終わる
- コメントは日本語（Fossil は英語だが、この作品は日本語で書く）。識別子は英語
- すべての関数に見出しコメントを付ける。何を受け取り、何をして、何を返すかを、本体を読まずに作り直せるくらいに書く。
  小さな関数は1行でよい。決断（`D`）や出来事（`EVENTS`）の項目、表や定数、広い範囲で使う変数にも用途を書く
- 複数行のコメントは `/*` と `*/` を単独の行に置き、間の行の頭に `**` を付ける。1行なら `/* … */`。`//` は使わない
- 制御文の形：`if( x ){` / `}else if( y ){` / `}else{` / `while( x ){` / `switch( x ){` / `for(i = 0; i < n; i++){` /
  `try{ … }catch(e){`。関数は `function f(a, b){`
- ブロックは1文でも必ず `{ }` で囲む
- 演算子の前後とカンマの後に空白。オブジェクトの `{}` の内側には空白を入れない（`{a: 1}`）。文の終わりに `;`
- HTML のテンプレートに込み入った式を埋め込まない。手前で変数に取り出し、テンプレートには名前だけを置く
- 点検は `node tools/style.js`

## 変更の作法（Fossil に寄せる）
Fossil の「Rebase Considered Harmful」（https://fossil-scm.org/home/doc/trunk/www/rebaseharm.md）に寄せる。履歴は起きたとおりに残す。
- 履歴を書き換えない。rebase・amend・squash・force push をしない。間違えたら新しいコミットで直す（取り消しは `git revert`）
- main へは「Create a merge commit」で入れる（Squash and merge と Rebase and merge は使わない）。
  作業ブランチを最新にするときも rebase ではなく、main を取り込むマージ（`git merge origin/main`）
- マージも Fossil に寄せる。Fossil の `merge` は作業フォルダに取り込むだけでコミットしない。試してから `commit` する。
  git では次のように置き換え、このリポジトリの git の設定（`.git/config`）でそう動くようにしてある
  - `fossil update` ＝ `git pull`。早送りだけ（`pull.ff=only`）。未コミットの変更は退避して新しい先頭に載せ直す
    （`merge.autoStash=true`）。ぶつかったら作業フォルダに衝突として残る
  - 手元にもコミットがあって分かれていたら `git pull` は止まる（Fossil の fork にあたる）。そのときは
    `git fetch` のあと `git merge origin/main` で取り込む
  - `fossil merge` ＝ `git merge`。main の上では取り込むだけでコミットしない（`branch.main.mergeOptions=--no-commit`）。
    早送りにせず必ずマージコミットを作る（`merge.ff=false`。Fossil の履歴と同じく、合流したことを残す）。
    main 以外のブランチの上では設定が効かないので `git merge --no-commit` と書く
  - 取り込んだら、下の「コミットの前に試す」とブラウザでの動作確認を済ませてから `git commit` でマージコミットを作る。
    やめるときは `git merge --abort`（Fossil の `undo` にあたる）
  - GitHub の PR は取り込みとコミットを分けられないので、マージボタンを押す前にブランチの側で試しておく
- 改行は LF だけ。Windows の git が取り出すときに CRLF に変えないよう、このリポジトリでは `core.autocrlf=false` にしてある
- 上の git の設定は `.git/config` にあり、clone し直すと消える。そのときは次で入れ直す：
  `git config pull.ff only; git config merge.ff false; git config merge.autoStash true;`
  `git config branch.main.mergeOptions --no-commit; git config core.autocrlf false`
- コミットは小さく、1つのコミットに1つの事柄。メッセージには何を・なぜを書く
- ブランチは合流したあとも消さない
- 作業中のものも早めに push して見える場所に置く（手元で抱え込まない）
- コミットの前に試す：
  - `node tools/style.js`（問題なし）
  - `node tools/choices.js -n 200`（エラー 0件）
  - `node tools/fate.js`（違い 0人、版の答えと同じ。動きを変えたら `E.VERSION` を上げて `--golden`）
  - 動きを変えないつもりの変更は、`node tools/simulate.js --seed 1`（`--era old` も）の出力を前後で比べて一致を確かめる
- PR #1〜#3 はこの決まりの前に rebase でマージした。履歴は書き換えないので、そのまま残す
