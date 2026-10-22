/*
** lab：人の記録を SQLite（sql.js の in-memory データベース）に置く。
** data.js・sim.js と vendor/sql-wasm.js を先に読み込むこと。
**
** Eridu.hooks に関数を入れ、人の生まれ・記録の文・選んだ選択肢・
** 1年の終わりを表に書く。表の意味は docs/schema.md。
**
** データベースは in-memory で動かし、書き込みのあと少し待って
** localStorage に丸ごと保存する（次に開いたときに読み戻す）。
** 住民番号はシーズンごとに順に配り、使い切ったら次のシーズンを始める
** （ワイプ）。前のシーズンの行は消さずに残す。
**
** 用意ができたら Eridu.db（sql.js の Database）を置き、Eridu.dbReady
** （Promise）を解決する。用意ができる前の書き込みは捨てる（lab の
** 画面は用意ができるまで「生まれる」を押せない）。書き込みで起きた
** エラーはゲームを止めないよう受け止めて、Eridu.dbErrors に溜める。
*/
(function(E){
  /*
  ** 表の版。表の形を変えたら上げる。保存してあるデータベースの版が
  ** 違えば、読み戻さずに作り直す（lab なので移し替えはしない）。
  */
  const VERSION = 2;

  /* 表を作る SQL。人が増えても欄は増やさない */
  const SCHEMA = `
CREATE TABLE districts(
  id TEXT PRIMARY KEY, name TEXT, zone TEXT,
  wealth REAL, exp REAL, crime REAL, edu REAL, med REAL, dis REAL
);
CREATE TABLE jobs(
  id TEXT PRIMARY KEY, name TEXT,
  inc REAL, eth REAL, haz REAL, hap REAL
);
CREATE TABLE kinds(id TEXT PRIMARY KEY, name TEXT, grp TEXT);
CREATE TABLE options(
  id TEXT PRIMARY KEY, key TEXT,
  t TEXT REFERENCES kinds(id), label TEXT
);
CREATE TABLE players(id TEXT PRIMARY KEY, created_at TEXT);
CREATE TABLE seasons(
  id INTEGER PRIMARY KEY,
  no_min INTEGER, no_max INTEGER,
  started_at TEXT, ended_at TEXT
);
CREATE TABLE games(
  id INTEGER PRIMARY KEY,
  season INTEGER REFERENCES seasons(id),
  player TEXT REFERENCES players(id),
  era TEXT, born_at TEXT
);
CREATE TABLE people(
  id INTEGER PRIMARY KEY,
  season INTEGER REFERENCES seasons(id),
  game INTEGER REFERENCES games(id),
  role TEXT,
  no INTEGER, era TEXT, name TEXT, sex TEXT,
  thiren INTEGER, kind TEXT, apt REAL,
  birth_d TEXT REFERENCES districts(id),
  d TEXT REFERENCES districts(id),
  age INTEGER, alive INTEGER, cause TEXT,
  hp REAL, hap REAL, know REAL, rel REAL, eth REAL, money REAL,
  job TEXT REFERENCES jobs(id),
  proxy INTEGER, married INTEGER, kids INTEGER,
  fall_age INTEGER, fall_survived INTEGER,
  family_lost INTEGER, reunited INTEGER, survivor INTEGER,
  witness INTEGER, lost_shop INTEGER,
  UNIQUE(season, no)
);
CREATE TABLE years(
  person INTEGER REFERENCES people(id),
  age INTEGER, alive INTEGER,
  d TEXT REFERENCES districts(id),
  job TEXT REFERENCES jobs(id),
  hp REAL, hap REAL, eth REAL, money REAL,
  PRIMARY KEY(person, age)
);
CREATE TABLE picks(
  id INTEGER PRIMARY KEY,
  person INTEGER REFERENCES people(id),
  age INTEGER, key TEXT,
  opt TEXT REFERENCES options(id)
);
CREATE TABLE log(
  id INTEGER PRIMARY KEY,
  person INTEGER REFERENCES people(id),
  age INTEGER, text TEXT, cls TEXT
);
`;

  /* localStorage の置き場所。DB_KEY はデータベース、PLAYER_KEY はこの端末のプレイヤー */
  const DB_KEY = "eridu-lab-db";
  const PLAYER_KEY = "eridu-lab-player";

  /* 住民番号の範囲の既定（6桁）。開発用に ?ids=N で1シーズンを N 人にできる */
  const NO_MIN = 100000;
  const NO_MAX = 999999;
  const IDS = +new URLSearchParams(location.search).get("ids") || 0;

  /* 真偽を 0 / 1 にして返す。 */
  const b = v => (v ? 1 : 0);

  /*
  ** people の欄（id・season・game・role・no・fall_survived を除く）と、
  ** 人 p からその値を取り出す関数の組。生まれたときと毎年の書き戻しで
  ** 使う。no は配った番号を書き、fall_survived は陥落の選択を当てた
  ** 直後にだけ書く（pick を見る）。
  */
  const COLS = [
    ["era", p => p.era],
    ["name", p => p.name],
    ["sex", p => p.sex],
    ["thiren", p => b(p.thiren)],
    ["kind", p => p.kind],
    ["apt", p => p.apt],
    ["birth_d", p => p.birthD.id],
    ["d", p => p.d.id],
    ["age", p => p.age],
    ["alive", p => b(p.alive)],
    ["cause", p => p.cause],
    ["hp", p => p.hp],
    ["hap", p => p.hap],
    ["know", p => p.know],
    ["rel", p => p.rel],
    ["eth", p => p.eth],
    ["money", p => p.money],
    ["job", p => p.job],
    ["proxy", p => b(p.proxy)],
    ["married", p => b(p.married)],
    ["kids", p => p.kids],
    ["fall_age", p => p.fallAge],
    ["family_lost", p => b(p.flags.familyLost)],
    ["reunited", p => b(p.flags.reunited)],
    ["survivor", p => b(p.flags.survivor)],
    ["witness", p => b(p.flags.witness)],
    ["lost_shop", p => b(p.flags.lostShop)],
  ];
  const NAMES = COLS.map(c => c[0]);
  const INSERT_PERSON =
    "INSERT INTO people(season, game, role, no, " + NAMES.join(", ") +
    ") VALUES(?, ?, ?, ?, " + NAMES.map(() => "?").join(", ") + ")";
  const UPDATE_PERSON =
    "UPDATE people SET " + NAMES.map(n => n + " = ?").join(", ") +
    " WHERE id = ?";

  /*
  ** 人のオブジェクトから people.id を引く表（まだ表になければ 0）。
  ** sim.js の人には欄を足さない
  */
  const ids = new WeakMap();
  /* 今の一生の games.id と、そのシーズン */
  let game = 0;
  let season = 0;
  /* 用意ができた Database。できるまでは null */
  let db = null;
  /* この端末のプレイヤーの id */
  let player = "";
  /* 保存の予約（setTimeout の番号） */
  let saveTimer = 0;
  E.dbErrors = [];

  /*
  ** SQL の sql を値の配列 vals で実行し、保存を予約する。用意ができて
  ** いなければ何もしない。エラーはゲームを止めないよう受け止め、
  ** E.dbErrors に文を残す。
  */
  function run(sql, vals){
    if( !db ){
      return;
    }
    try{
      db.run(sql, vals);
    }catch(e){
      E.dbErrors.push(e.message + " / " + sql);
    }
    scheduleSave();
  }

  /* SQL の sql を値の配列 vals で問い合わせ、最初の行の最初の値を返す。 */
  function one(sql, vals){
    const r = db.exec(sql, vals);
    return r.length ? r[0].values[0][0] : null;
  }

  /* 人 p の people の欄の値を、COLS の順の配列にして返す。 */
  const values = p => COLS.map(c => c[1](p));

  /*
  ** 今のシーズンで、まだ配っていない住民番号がいくつ残っているかを返す。
  ** ?ids=N のときは、シーズンの初めから N 人までで使い切ったことにする。
  */
  function remaining(){
    const lo = one("SELECT no_min FROM seasons WHERE id = ?", [season]);
    let hi = one("SELECT no_max FROM seasons WHERE id = ?", [season]);
    if( IDS ){
      hi = Math.min(hi, lo + IDS - 1);
    }
    const used = one("SELECT max(no) FROM people WHERE season = ?", [season]);
    return hi - (used === null ? lo - 1 : used);
  }

  /*
  ** 新しいシーズンを始める（ワイプ）。今のシーズンには終わった時刻を
  ** 書き、行は消さずに残す。番号は新しいシーズンの頭から配り直す。
  */
  function newSeason(){
    const now = new Date().toISOString();
    if( season ){
      run("UPDATE seasons SET ended_at = ? WHERE id = ?", [now, season]);
    }
    run(
      "INSERT INTO seasons(no_min, no_max, started_at) VALUES(?, ?, ?)",
      [NO_MIN, NO_MAX, now]
    );
    season = one("SELECT last_insert_rowid()");
  }

  /* 今のシーズンで次に配る住民番号を返す（配るのは people に足すとき）。 */
  function nextNo(){
    const lo = one("SELECT no_min FROM seasons WHERE id = ?", [season]);
    const used = one("SELECT max(no) FROM people WHERE season = ?", [season]);
    return used === null ? lo : used + 1;
  }

  /*
  ** 生まれた人を覚えておく。本人はすぐ表に入れる（住民票に出す住民番号を
  ** 最初から決めるため）。同じ1秒の4人を表に入れるのは、初めて記録や
  ** 選択や1年の終わりが来たとき（ensure）。名前が重なって捨てられた
  ** 候補のように、一度も動かなかった人は表に入らない。
  */
  E.hooks.born = p => {
    ids.set(p, 0);
    if( !p.isPeer ){
      ensure(p);
    }
  };

  /*
  ** p がまだ表になければ people に足し、people.id を返す。本人
  ** （isPeer でない人）を足すときは新しい一生（games）を始める。そのとき
  ** シーズンの番号が一生ぶん（本人と4人の5つ）残っていなければ、
  ** 先に新しいシーズンを始める。同じ1秒の4人はその時点の一生に入れる。
  ** 住民番号はここで配り、p.no も書き換える。
  */
  function ensure(p){
    let id = ids.get(p);
    if( id || !db ){
      return id;
    }
    if( !p.isPeer ){
      if( remaining() < 5 ){
        newSeason();
      }
      run("INSERT INTO games(season, player, era, born_at) " +
        "VALUES(?, ?, ?, ?)", [
        season, player, p.era, new Date().toISOString(),
      ]);
      game = one("SELECT last_insert_rowid()");
    }
    p.no = nextNo();
    const role = p.isPeer ? "peer" : "me";
    run(INSERT_PERSON, [season, game, role, p.no, ...values(p)]);
    id = one("SELECT last_insert_rowid()");
    ids.set(p, id);
    return id;
  }

  /* 今のシーズンの番号・残りの住民番号・この端末のプレイヤーを返す。 */
  E.dbInfo = () => ({season, left: db ? remaining() : 0, player});

  /* 記録の文を log に足す。 */
  E.hooks.said = (p, text, cls) => {
    run("INSERT INTO log(person, age, text, cls) VALUES(?, ?, ?, ?)", [
      ensure(p), p.age, text, cls,
    ]);
  };

  /*
  ** 選んだ選択肢を picks に足し、人の欄を書き戻す。選択肢は初めて
  ** 出たときに options に足す（ラベルは最初に出たもの）。陥落の選択なら、
  ** その時点で生きているかを fall_survived に書く。
  */
  E.hooks.pick = (p, dec, o) => {
    const id = ensure(p);
    run("INSERT OR IGNORE INTO options VALUES(?, ?, ?, ?)", [
      o.id, dec.key, o.t, o.label,
    ]);
    run("INSERT INTO picks(person, age, key, opt) VALUES(?, ?, ?, ?)", [
      id, p.age, dec.key, o.id,
    ]);
    run(UPDATE_PERSON, [...values(p), id]);
    if( dec.alarm ){
      run("UPDATE people SET fall_survived = ? WHERE id = ?", [
        b(p.alive), id,
      ]);
    }
  };

  /* 1年を終えた人の欄を書き戻し、その年の状態を years に足す。 */
  E.hooks.year = p => {
    const id = ensure(p);
    run(UPDATE_PERSON, [...values(p), id]);
    run("INSERT OR REPLACE INTO years VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      id, p.age, b(p.alive), p.d.id, p.job, p.hp, p.hap, p.eth, p.money,
    ]);
  };

  /* 決まった表（地区・仕事・選択肢の型）を data.js と sim.js から埋め直す。 */
  function fillFixed(){
    for(const d of E.DISTRICTS){
      db.run(
        "INSERT OR REPLACE INTO districts VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [d.id, d.name, d.zone, d.wealth, d.exp, d.crime, d.edu, d.med, d.dis]
      );
    }
    for(const [id, j] of Object.entries(E.JOBS)){
      db.run("INSERT OR REPLACE INTO jobs VALUES(?, ?, ?, ?, ?, ?)", [
        id, j.name, j.inc, j.eth, j.haz, j.hap,
      ]);
    }
    for(const [id, k] of Object.entries(E.KINDS)){
      db.run("INSERT OR REPLACE INTO kinds VALUES(?, ?, ?)", [
        id, k.name, k.group,
      ]);
    }
  }

  /* バイト列 u（Uint8Array）を base64 の文字列にして返す。 */
  function toBase64(u){
    let s = "";
    for(let i = 0; i < u.length; i += 0x8000){
      s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  /* base64 の文字列 s をバイト列（Uint8Array）にして返す。 */
  function fromBase64(s){
    const t = atob(s);
    const u = new Uint8Array(t.length);
    for(let i = 0; i < t.length; i++){
      u[i] = t.charCodeAt(i);
    }
    return u;
  }

  /*
  ** データベースを丸ごと localStorage に保存する。入りきらないなど
  ** 書けなければ E.dbErrors に残して続ける。
  */
  function save(){
    clearTimeout(saveTimer);
    saveTimer = 0;
    if( !db ){
      return;
    }
    try{
      localStorage.setItem(DB_KEY, toBase64(db.export()));
    }catch(e){
      E.dbErrors.push("保存できませんでした：" + e.message);
    }
  }
  E.dbSave = save;

  /* 1秒後に保存するよう予約する（続けて書いたら1回にまとめる）。 */
  function scheduleSave(){
    if( !saveTimer ){
      saveTimer = setTimeout(save, 1000);
    }
  }

  /*
  ** 保存してあるデータベースを読み戻して返す。なければ、読めなければ、
  ** 表の版が違えば null を返す。
  */
  function load(SQL){
    try{
      const s = localStorage.getItem(DB_KEY);
      if( !s ){
        return null;
      }
      const d = new SQL.Database(fromBase64(s));
      const v = d.exec("PRAGMA user_version")[0].values[0][0];
      if( v !== VERSION ){
        d.close();
        return null;
      }
      return d;
    }catch(e){
      return null;
    }
  }

  /* この端末のプレイヤーの id を返す。なければ作って残す。 */
  function playerId(){
    let id = "";
    try{
      id = localStorage.getItem(PLAYER_KEY) || "";
    }catch(e){}
    if( !id ){
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2);
      try{
        localStorage.setItem(PLAYER_KEY, id);
      }catch(e){}
    }
    return id;
  }

  /*
  ** wasm を読み込み、保存してあるデータベースを読み戻す（なければ作る）。
  ** 決まった表を埋め直し、この端末のプレイヤーと今のシーズンを決めて
  ** から E.db を置く。
  */
  E.dbReady = initSqlJs({locateFile: f => "vendor/" + f}).then(SQL => {
    let d = load(SQL);
    if( !d ){
      d = new SQL.Database();
      d.exec(SCHEMA);
      d.exec("PRAGMA user_version = " + VERSION);
    }
    d.exec("PRAGMA foreign_keys = ON");
    db = d;
    fillFixed();
    player = playerId();
    run("INSERT OR IGNORE INTO players VALUES(?, ?)", [
      player, new Date().toISOString(),
    ]);
    season = one("SELECT max(id) FROM seasons") || 0;
    if( !season ){
      newSeason();
    }
    E.db = db;
    E.player = player;
    return db;
  });

  /* 画面を閉じるときは、予約を待たずに保存する */
  addEventListener("pagehide", save);
})(globalThis.Eridu);
