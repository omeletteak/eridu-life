# Cloudflare Worker（lab の道の共有）

lab の「世界と道」（`docs/world.md`）を複数人で遊べるようにするため、
みんなの道を Cloudflare の D1（中身は SQLite）に集める Worker。方針と段取りは
GitHub issue #21。本編は今までどおり GitHub Pages で配信し、この Worker とは
つながっていない。lab をつなぐのはこれから（今の lab は端末の中の表だけを使う）。

URL：https://eridu-life.omeletteanko.workers.dev

## ファイル
| ファイル | 役目 |
|---|---|
| `worker/src/index.js` | 入口。`/hello` と `/api/…` を振り分ける。ほかは 404 |
| `worker/src/api.js` | 道の共有の API。番号を配る・道を受け取る・同じ1秒の道を返す |
| `worker/src/eridu.js` | 本編の `js/data.js` と `js/sim.js` を Worker に読み込む |
| `worker/schema.sql` | D1 の表。lab と同じ形（`docs/schema.md`）に、目印の `marks`、`walked`・`routes` を足したもの |
| `worker/wrangler.toml` | wrangler の設定（名前・入口・D1 のつなぎ） |
| `tools/api.js` | API の点検。手元の Worker に要求を送って答えを調べる |

- Worker は ES modules（`export default`）で書く。Workers の決まりなので、本編の
  「ES modules を使わない」の例外。本編からは読まない
- sim.js は写さずに読み込む（wrangler が1つにまとめる）。版（`E.VERSION`）は
  main の sim.js のものになり、版が上がってデプロイされると新しいシーズンが始まる
- ライブラリは入れない。wrangler はその場で `npx` で呼ぶ（`package.json` を置かない）

## API
どれも JSON を返す。失敗したら `{error: 理由}` と 4xx。SQL は Worker の中で
組み、値はいつもプレースホルダで渡す（端末から SQL は受け取らない）。

| 要求 | 本文 / 引数 | 答え |
|---|---|---|
| `GET /api/season` | なし | `{season, version, left: {now, old}}`（歩かれていない番号の数） |
| `POST /api/born` | `{player, era, place, version}` | `{game, season, version, era, no, reborn}` |
| `POST /api/died` | `{player, game, path}` | `{mark, age, cause}`（mark は ✦ の印を付けるか） |
| `GET /api/peers?game=N&player=P` | born の `game` と自分の `player` | `{season, version, era, peers: [{no, path}]}` |

- born：番号は `lab/fate.js` と同じ決まりで配る（20% はもう歩かれた番号、ほかは
  まだ歩かれていない番号のいちばん小さいもの。場所を選んだらそこに生まれる番号）。
  `games` に1行書いて、2時間は同じ番号をほかの人に配らない（予約）。
  `version` が今の sim.js と違えば 409 と今の版を返す（端末の読み込み直しが要る）
- died：`path` は選択肢の ID の配列。同じ `game` は1回だけ。Worker の中で sim.js で
  たどり直し、道のとおりに選べない・決断が余る・最期まで行かない道は 400。年齢・
  死因などは端末から受け取らず、たどり直した結果を people に書く（端末とは細かい
  数が違うことがあるが、選択・年齢・死因は同じになる。#11）。同じ番号をまったく
  同じ道で歩いた人がまだいなければ `mark` が true
- died：生まれてから決断1回につき1秒（`MIN_PICK_MS`）より早いと 400。生まれた
  あとで版が上がった一回は、たどり直せないので 409
- died の ✦ と歩かれた番号の数は、`routes`・`walked` に入ったかで決める
  （同時に送られても1人にしか付かない）
- peers：自分の `game` にだけ答える。同じ1秒の4人。歩かれた番号なら、空でない道のうち、いちばん早く歩き
  はじめた人の道。歩かれていなければ `path` は null
- 端末は `season`・`version`・`era`・`no` から運命の名前（`s1|v2|now|100000`）を
  作り、本人と4人を自分で作る

## いたずらへの備え
- born と died は、IP ごとに1分に10回まで（`wrangler.toml` の `[[ratelimits]]`。
  超えたら 429）。IP はハッシュの頭だけを `games.ip` に残す
- 1つの IP の遊びかけの予約は5つまで（超えたら 429）
- 空いた番号を探して表を引くのは5回まで。予約で埋まって見つからなければ 503
  （1回の要求の D1 の問い合わせの上限に当たらないように）
- 本文は 16KB まで（超えたら 413）

## 書き込みの量
D1 の無料の枠は、書き込みが1日10万行（索引の更新も数える）。一生で書くのは、
生まれたとき（games と目印）と亡くなったとき（people と目印）の数行だけ。
1日 1万人ほどまでは収まる見込み。

## まだしないこと（issue #21 の続き）
- lab をこの API につなぐ（lab を Worker からも配って、同じ URL で動かす。CORS を
  付けるなら https://omeletteak.github.io だけ。ほかの人の道や名前は textContent で出す）
- プレイヤーの本人確認（今は端末の乱数の id だけ）

## D1 の用意（ダッシュボードで1回だけ）
1. 「ストレージとデータベース」→「D1 SQL Database」で `eridu-life` を作る
2. 出てきた ID を `wrangler.toml` の `database_id` に書く
3. そのデータベースの「Console」に `worker/schema.sql` を丸ごと貼って実行する
   （何度実行しても壊れない）

PR #23 のマージの前に一度実行していたら、表を消してから実行し直す（中身は
まだ空）：`DROP TABLE IF EXISTS people; DROP TABLE IF EXISTS games;`
`DROP TABLE IF EXISTS marks; DROP TABLE IF EXISTS seasons;`

表の形を変えるときは、`schema.sql` を直し、移し替えの SQL（`ALTER TABLE …`）を
Console で実行する。前のシーズンの行は消さない。

## 手元で動かす
Node.js 18 以上が要る。

```
cd worker
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --var MIN_PICK_MS:0
node ../tools/api.js -n 300
```

手元の D1 は `worker/.wrangler/` に置かれる（git には入れない）。
`tools/api.js` は表に行を書くので、本番の URL には向けない。決断のたびに待たない
ので、`MIN_PICK_MS` を 0 にした Worker に向ける。

## デプロイ
ダッシュボードの Git 連携で、main が更新されるとデプロイされる。`wrangler.toml`
の `name` はダッシュボードの Worker の名前（`eridu-life`）と同じにしておく。

PR を出すと、Git 連携が `wrangler preview` でプレビューを作る。そのため
`wrangler.toml` に空の `[previews]` を置いている。D1 のつなぎはプレビューに
引き継がれないので、プレビューの `/api/…` は 503 を返す（本番の表には書かない）。
