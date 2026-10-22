# 表の設計（案）

人の状態をキーと値の袋（`p.flags` など）で持つのをやめ、
欄の決まった表の行として持つための設計案。まだコードは変えていない。

## ねらい
- どんな欄があるかを、コードを読まなくてもこの表の一覧で分かるようにする
- 欄は最初に全部決めておき、実行中に足さない
- 人どうし・人と地区などのつながりは、オブジェクトの入れ子ではなく ID で持つ
- ブラウザ（file://、ライブラリなし）でも Node でも同じ形で動く。
  `tools/simulate.js` からは同じ形のまま SQLite に書き出せる

## 表の一覧

```
districts ─┐
jobs ──────┤
options ───┤   （決まった表。data.js / sim.js から作る）
events ────┘
              ↑ ID で参照
people ──┬── picks   （決断1回で1行）
         ├── happenings（出来事1回で1行）
         └── log     （記録の文1つで1行）
```

### people（1人1行）
今の `newPerson()` の欄と、`flags` のうち「状態」にあたるものを決まった欄にする。

| 欄 | 型 | 中身 | 今のどこ |
|---|---|---|---|
| id | 整数 | 人の番号（表の中で一意） | 新設 |
| no | 整数 | 住民番号（表示用） | `p.no` |
| era | 文字 | `now` / `old` | `p.era` |
| is_peer | 真偽 | 同じ1秒に生まれた4人か | `p.isPeer` |
| name | 文字 | 名前 | `p.name` |
| sex | 文字 | 性別 | `p.sex` |
| thiren | 真偽 | シリオンか | `p.thiren` |
| kind | 文字 | シリオンの種類（人間なら NULL） | `p.kind` |
| apt | 数 | エーテル適性（隠し） | `p.apt` |
| birth_d | 文字 | 出生地区 → districts.id | `p.birthD`（オブジェクト） |
| d | 文字 | 今の住所 → districts.id | `p.d`（オブジェクト） |
| age | 整数 | 年齢 | `p.age` |
| alive | 真偽 | 生きているか | `p.alive` |
| cause | 文字 | 死因（生きていれば NULL） | `p.cause` |
| hp / hap / know / rel / eth | 数 | 健康 / 幸福 / 知識 / 人間関係 / 侵蝕 | 同名 |
| money | 数 | 貯え | `p.money` |
| job | 文字 | 仕事 → jobs.id | `p.job` |
| proxy | 真偽 | 裏稼業をしているか | `p.proxy` |
| married | 真偽 | 結婚しているか | `p.married` |
| kids | 整数 | 子どもの数 | `p.kids` |
| fall_age | 整数 | 陥落に遭う年齢（今の時代は NULL） | `p.fallAge` |
| fall_survived | 真偽 | 陥落の時点で生きていたか | `p.fallSurvived` |
| family_lost | 真偽 | 陥落で家族が消息不明になった | `flags.familyLost` |
| reunited | 真偽 | 消息不明の家族と再会した | `flags.reunited` |
| survivor | 真偽 | 範囲の中で陥落を生き延びた | `flags.survivor` |
| witness | 真偽 | 範囲の外で陥落を見届けた | `flags.witness` |
| lost_shop | 真偽 | 陥落で店を失った | `flags.lostShop` |
| disaster | 真偽 | ホロウ災害の決断が控えている | `flags.disaster` |

### picks（決断1回で1行）
| 欄 | 型 | 中身 |
|---|---|---|
| person | 整数 | → people.id |
| age | 整数 | 選んだ年齢 |
| key | 文字 | 決断の種類（`school` / `fall` など） |
| opt | 文字 | 選んだ選択肢 → options.id |

「その決断は済んだか」は、この表に行があるかで分かる。
次の `flags` はこの表で置き換わるので無くなる。

| 今の flags | 置き換え |
|---|---|
| `d15` `d18` `d24` `d29` `d42` `d62` | key が school / work / proxy / family / turn / retire の行がある |
| `fall` | key が fall / fallAlone / fallFar / fallFarAlone の行がある |
| `ethDec` | key が ether の行がある |
| `disDone` | key が disaster の行がある |
| `study` | opt が `school.study` |
| `wild` | opt が `school.wild` |
| `bangboo` | opt が `family.alone` |
| `oldwork` | opt が `retire.work` |
| `treated` | opt が `ether.treat` |
| `ignoreEth` | opt が `ether.endure` か `ether.wait` |

24歳の裏稼業の誘いは「来なかった年」がある。行を残さないと翌年また
試してしまうので、`opt` を NULL にした行（誘いが来なかった）を残す。

### happenings（出来事1回で1行）
| 欄 | 型 | 中身 |
|---|---|---|
| person | 整数 | → people.id |
| age | 整数 | 起きた年齢 |
| event | 文字 | → events.id |

今の `EVENTS` には ID がないので、各項目に `id` を付ける必要がある。

### log（記録の文1つで1行）
| 欄 | 型 | 中身 |
|---|---|---|
| person | 整数 | → people.id |
| age | 整数 | 年齢 |
| text | 文字 | 文 |
| cls | 文字 | 表示の種類（good / bad / eth / big） |

`p.years`（寿命の帯に出す1年ごとの印 l / e / x）は、毎年の行を持つ表
（`years`: person / age / mark）にするか、表示のときに log と picks から作る。

### 決まった表
| 表 | 今 | 変えること |
|---|---|---|
| districts | `DISTRICTS`（配列、id あり） | そのまま使える |
| jobs | `JOBS`（キーで引くオブジェクト） | `{id: "corp", name: …}` の行の配列にする |
| options | `D` の中の選択肢（id・t あり） | id / key / t / group を一覧にした表を作る |
| kinds | `KINDS`（キーで引くオブジェクト） | id / name / group の行にする |
| events | `EVENTS`（配列、id なし） | 各項目に id を付ける |

## 表に入れないもの
- `flags.stampNew`：住民票の「転出」スタンプを押す合図。画面だけの状態なので ui.js の変数にする
- `flags.forceAlone`：開発用（`&alone=1`）。ui.js から sim.js に渡す引数にする
- `fallChoice`：陥落で選んだラベル。picks の行から options を引けば出る

## 置き場所の案
```js
Eridu.db = {
  people: [],      /* 行の配列。各行は上の欄だけを持つ */
  picks: [],
  happenings: [],
  log: [],
};
```
決断の `fx(p)` や出来事の `fx(p)` は、`p` に people の行を渡して
`p.hp -= 10` のように書き換える今の形のまま使える。
前世の記録は people の行（と log）をそのまま localStorage に保存する。

## 進め方の案（このブランチで試す）
1. options / kinds / events の決まった表を作る（動きは変わらない）
2. picks の表を作り、選ぶたびに行を足す。flags の `d15` などを picks で置き換える
3. 残りの flags を people の欄にする。`flags` を消す
4. `p.d` / `p.birthD` を地区の ID にする
5. log / happenings を表にする
6. `tools/simulate.js --db` で SQLite に書き出す

各段で `node tools/simulate.js --seed 1`（`--era old` も）の出力が
変わらないことを確かめる。乱数を引く順番を変えないように注意する。

## 決めたいこと
- `p.years` を表にするか、表示のときに作るか
- 前世の記録（直近10件）に log まで残すか、people の行だけにするか
- 書き出しを SQLite にするか CSV にするか（SQLite なら Node 標準の `node:sqlite`）
