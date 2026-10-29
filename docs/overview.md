# 概要とファイル

ゼンレスゾーンゼロの世界観を借りた非公式ファン作品の人生シミュレーション。
元ネタは「80億分の1」（https://1in8b.life/ja/）。ランダムに生まれ、数年ごとの決断だけを選び、最期まで見届ける。

## 現状
- 試作版（HTML/CSS/JS、ライブラリなし）。チャットで作ったもの。ライブラリは lab/ の sql.js だけ（例外）
- main は安定して配信できるもの。`lab/` は実験場で、本編に混ぜない（本編は lab の仕組みを使わない）
- `eridu-life.html` をブラウザで直接開けば動く（file:// で動かすため ES modules は使わない）
- Cloudflare Worker からも配っている：https://eridu-life.omeletteak.workers.dev/（lab はこちらで開くと
  みんなで1つの世界になる。`docs/worker.md`）
- GitHub Pages で公開している：https://omeletteak.github.io/eridu-life/（main のルートから配信。
  `index.html` は `eridu-life.html` へ飛ばすだけ、`.nojekyll` で Jekyll を通さない）
- やることは GitHub の issue に置く

## ファイル
各ファイルの冒頭のコメントに、役目と使い方を書いている。

| ファイル | 役目 |
|---|---|
| `eridu-life.html` | マークアップだけ。data → sim → skyline → ui の順に script を読む |
| `css/style.css` | 見た目 |
| `js/data.js` | データ（DISTRICTS / 名前 / JOBS） |
| `js/sim.js` | シミュレーション本体。DOM に触らないので Node でも動く（`docs/sim.md`） |
| `js/skyline.js` | 旧都陥落の演出で出す、出生地区のスカイライン（`docs/fall.md`） |
| `js/ui.js` | 描画・操作・前世の記録 |
| `tools/simulate.js` | 一括シミュレーション（寿命・死因・地区別・仕事別・決断の回数） |
| `tools/choices.js` | 選択肢の総点検。決断や選択肢を足したら、ここの SCENES にも場面を足す |
| `tools/fate.js` | 運命の点検と、版の上げ忘れの点検（答えは `tools/fate-golden.json`） |
| `tools/style.js` | 書き方の点検 |
| `tools/api.js` | 道の共有の API の点検（手元の Worker に向ける。`docs/worker.md`） |
| `lab/` | 試験版。人の記録を SQLite に置き、世界と道の仕組みを試す（`docs/world.md`・`docs/schema.md`） |
| `worker/` | lab の道を共有する Cloudflare Worker と D1 の表（`docs/worker.md`） |

- data.js と sim.js は `globalThis.Eridu` に載せる形。ブラウザでは script タグ、Node では `require` で読む
- `lab/index.html` は `eridu-life.html` の写し（パスを `../` に、lab の script と注記を足したもの）。
  本編のマークアップを変えたらこちらも合わせる
- `lab/vendor/` は sql.js 1.15.2（MIT、SQLite 3.54.0）。手を入れない

## 画面の決まり
- 住民番号は、亡くなるまで存在ごと出さない（住民票の見出しは「住民記録」だけ）。亡くなると住民票・最期の画面・
  前世の記録に出す（本編も lab も）

## 開発用の URL
- `eridu-life.html?fall`：旧都陥落の前に生まれ、1歳で陥落が来る。`?fall=near` で範囲の中、`?fall=far` で範囲の外。
  `&age=45` でその年齢で陥落が来る（それまでは一気に進める）。`&alone=1` で家族が消息不明の状況
- `lab/?ids=N`：1シーズンを N 人に（ワイプの確認）／`&reborn=1`：必ず歩かれた番号に生まれる／`?sql`：SQL の欄を出す
