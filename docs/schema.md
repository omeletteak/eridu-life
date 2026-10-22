# 表（lab/db.js）

`lab/` で人の記録を置く SQLite の表。仕組みの考え方は `docs/world.md`。

## 置き場所
- ブラウザ：sql.js（`lab/vendor/`）の in-memory データベース。書き込みのあと
  1秒待って丸ごと localStorage に保存し、次に開いたときに読み戻す
  （1回遊ぶと約20KB。上限の約5MBで250回ほど。入らなくなったら保存のエラーと
  して出し、遊ぶのは続けられる）
- 計算の途中は SQL にしない。決断や出来事の `fx(p)` は人のオブジェクトを
  書き換える今の形のまま使い、亡くなったときに `Eridu.hooks` 経由でまとめて書く

## 表の一覧
```
districts / jobs / kinds / options   決まった表（data.js / sim.js から埋める）
players ── games ── people ──┬── picks
seasons ──┘                  └── log
```

### players / seasons / games
| 表 | 欄 | 中身 |
|---|---|---|
| players | id, created_at | プレイヤー（遊ぶ人）。lab では端末ごとに1つ（localStorage） |
| seasons | id, version, no_min, no_max, started_at, ended_at | シーズン。版と住民番号の範囲 |
| games | id, season, player, version, era, no, born_at | 歩いた一回。誰が・どの番号を・いつ・どの版で |

### people（歩いた一回で1行。本人だけ、games と1対1）
同じ番号を何人も歩けるので、番号は重なってよい。

| 欄 | 中身 |
|---|---|
| id / game | people の番号 / → games.id |
| season / era / no | シーズン / 時代 / 住民番号 |
| path | 選んだ選択肢の ID をカンマでつないだもの |
| name / sex / thiren / kind / apt | 名前 / 性別 / シリオンか / 種類 / エーテル適性 |
| birth_d / d | 出生地区 / 最期の住所（→ districts.id） |
| age / alive / cause | 最期の年齢 / 生きているか（いつも 0）/ 死因 |
| hp / hap / know / rel / eth / money | 最期の状態値 |
| job / proxy / married / kids | 最期の仕事（→ jobs.id）/ 裏稼業 / 結婚 / 子どもの数 |
| fall_age / fall_survived | 陥落に遭う年齢 / 陥落の時点で生きていたか |
| family_lost / reunited / survivor / witness / lost_shop | 陥落まわりの出来事（今は `p.flags` から写す） |

### picks（決断1回で1行）
| 欄 | 中身 |
|---|---|
| person | → people.id |
| age / key / opt | 選んだ年齢 / 決断の種類 / 選んだ選択肢（→ options.id） |

### log（記録の文1つで1行）
| 欄 | 中身 |
|---|---|
| person | → people.id |
| age / text / cls | 年齢 / 文 / 表示の種類（good / bad / eth / big） |

### 決まった表
| 表 | 中身 |
|---|---|
| districts | `DISTRICTS` の id・名前・範囲の中か外か・暮らしの数値 |
| jobs | `JOBS` の id・名前・年収・侵蝕・危険・幸福 |
| kinds | 選択肢の型（`KINDS`）の id・名前・組 |
| options | 選ばれた選択肢の id・決断の種類・型・最初に出たラベル（初めて選ばれたときに足す） |

## 列を足すとき
- 表の版（`lab/db.js` の `VERSION`）を1つ上げ、`MIGRATIONS` にその版へ移す
  SQL（`ALTER TABLE … ADD COLUMN …` など）を足す。保存してある古い
  データベースは、読み戻すときに順に移し替える（消さない）
- 足した列は、前の行では NULL になる。番号と道があれば一生を作り直せるので、
  一生から分かる値なら、前の行もあとから埋められる
- 列の名前を変えたり消したりは避ける（共有した記録と合わなくなる）
