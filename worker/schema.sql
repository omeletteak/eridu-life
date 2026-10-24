-- D1 に置く表（docs/worker.md）。Cloudflare のダッシュボードの D1 の
-- Console に丸ごと貼って1回実行する。何度実行しても壊れない。
-- 表の形は lab と同じ（docs/schema.md）。lab にない marks だけを足す。

-- シーズン。版（E.VERSION）と住民番号の範囲。行は消さない
CREATE TABLE IF NOT EXISTS seasons(
  id INTEGER PRIMARY KEY,
  version INTEGER,
  no_min INTEGER, no_max INTEGER,
  started_at TEXT, ended_at TEXT
);

-- シーズン・時代・生まれる場所ごとの、番号を探しはじめる目印。
-- place が '' の行は、low がまだ歩かれていない番号のいちばん小さいもの、
-- walked が歩かれた番号の数。地区の id の行は、low より前にその地区に
-- 生まれる番号はもう配った、という印（walked は使わない）
CREATE TABLE IF NOT EXISTS marks(
  season INTEGER, era TEXT, place TEXT,
  low INTEGER, walked INTEGER,
  PRIMARY KEY(season, era, place)
);

-- 歩いた一回。生まれたときに書き、番号の予約を兼ねる
CREATE TABLE IF NOT EXISTS games(
  id INTEGER PRIMARY KEY,
  season INTEGER REFERENCES seasons(id),
  player TEXT,
  version INTEGER,
  era TEXT, no INTEGER,
  born_at TEXT
);
CREATE INDEX IF NOT EXISTS games_no ON games(season, era, no);

-- 歩き終えた一回（亡くなったときに書く）。games と1対1。
-- 今は path・age・cause・died_at だけを埋める。ほかの欄は lab と同じ形で、
-- サーバーでたどり直すようになったら埋める
CREATE TABLE IF NOT EXISTS people(
  id INTEGER PRIMARY KEY,
  game INTEGER UNIQUE REFERENCES games(id),
  season INTEGER REFERENCES seasons(id),
  era TEXT, no INTEGER,
  path TEXT,
  name TEXT, sex TEXT,
  thiren INTEGER, kind TEXT, apt REAL,
  birth_d TEXT, d TEXT,
  age INTEGER, alive INTEGER, cause TEXT,
  hp REAL, hap REAL, know REAL, rel REAL, eth REAL, money REAL,
  job TEXT,
  proxy INTEGER, married INTEGER, kids INTEGER,
  fall_age INTEGER, fall_survived INTEGER,
  family_lost INTEGER, reunited INTEGER, survivor INTEGER,
  witness INTEGER, lost_shop INTEGER,
  died_at TEXT
);
CREATE INDEX IF NOT EXISTS people_no ON people(season, era, no);
