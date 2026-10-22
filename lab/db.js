/*
** lab：遊んだ一生を SQLite（sql.js の in-memory データベース）に置く。
** data.js・sim.js と vendor/sql-wasm.js を先に読み込むこと。
**
** 世界は先に決まっている。シーズン・版・時代・住民番号から、その人の
** 生まれと運命（1年ごとの乱数）が決まり（sim.js の fate）、プレイヤーは
** その中の一本の道（選んだ選択肢の ID の並び）を歩くだけ。ここに残すのは、
** 誰が・いつ・どの番号を・どの道で歩いたか（games と people）と、
** その一生の記録（picks・log）。同じ1秒の4人は番号から作り直せるので
** 残さない（lab/fate.js）。
**
** データベースは in-memory で動かし、書き込みのあと少し待って
** localStorage に丸ごと保存する（次に開いたときに読み戻す）。
**
** 用意ができたら Eridu.db（sql.js の Database）を置き、Eridu.dbReady
** （Promise）を解決する。書き込みで起きたエラーはゲームを止めないよう
** 受け止めて、Eridu.dbErrors に溜める。
*/
(function(E){
  /*
  ** 表の版。表の形を変えたら上げる。保存してあるデータベースの版が
  ** 違えば、読み戻さずに作り直す（lab なので移し替えはしない）。
  */
  const VERSION = 3;

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
  version INTEGER,
  no_min INTEGER, no_max INTEGER,
  started_at TEXT, ended_at TEXT
);
CREATE TABLE games(
  id INTEGER PRIMARY KEY,
  season INTEGER REFERENCES seasons(id),
  player TEXT REFERENCES players(id),
  version INTEGER,
  era TEXT, no INTEGER,
  born_at TEXT
);
CREATE TABLE people(
  id INTEGER PRIMARY KEY,
  game INTEGER UNIQUE REFERENCES games(id),
  season INTEGER REFERENCES seasons(id),
  era TEXT, no INTEGER,
  path TEXT,
  name TEXT, sex TEXT,
  thiren INTEGER, kind TEXT, apt REAL,
  birth_d TEXT REFERENCES districts(id),
  d TEXT REFERENCES districts(id),
  age INTEGER, alive INTEGER, cause TEXT,
  hp REAL, hap REAL, know REAL, rel REAL, eth REAL, money REAL,
  job TEXT REFERENCES jobs(id),
  proxy INTEGER, married INTEGER, kids INTEGER,
  fall_age INTEGER, fall_survived INTEGER,
  family_lost INTEGER, reunited INTEGER, survivor INTEGER,
  witness INTEGER, lost_shop INTEGER
);
CREATE INDEX people_no ON people(season, era, no);
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

  /* 真偽を 0 / 1 にして返す。 */
  const b = v => (v ? 1 : 0);

  /*
  ** people の欄のうち、人 p から毎年書き戻すものと、その値を取り出す
  ** 関数の組。fall_survived は陥落の選択を当てた直後にだけ書く。
  */
  const COLS = [
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
    "INSERT INTO people(game, season, era, no, path, " + NAMES.join(", ") +
    ") VALUES(?, ?, ?, ?, '', " + NAMES.map(() => "?").join(", ") + ")";
  const UPDATE_PERSON =
    "UPDATE people SET " + NAMES.map(n => n + " = ?").join(", ") +
    " WHERE id = ?";

  /*
  ** 歩いている本人のオブジェクトから people.id を引く表。表に入るのは
  ** E.walk で歩きはじめた本人だけ（同じ1秒の4人や、開発用に作った人は
  ** 入らない）。sim.js の人には欄を足さない
  */
  const ids = new WeakMap();
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
  E.dbRun = run;

  /* SQL の sql を値の配列 vals で問い合わせ、最初の行の最初の値を返す。 */
  function one(sql, vals){
    const r = db.exec(sql, vals);
    return r.length ? r[0].values[0][0] : null;
  }
  E.dbOne = one;

  /*
  ** SQL の sql を値の配列 vals で問い合わせ、行を {欄: 値} の配列に
  ** して返す。
  */
  function rows(sql, vals){
    const r = db.exec(sql, vals);
    if( !r.length ){
      return [];
    }
    const cols = r[0].columns;
    return r[0].values.map(v => {
      const o = {};
      cols.forEach((c, i) => {
        o[c] = v[i];
      });
      return o;
    });
  }
  E.dbRows = rows;

  /* 人 p の people の欄の値を、COLS の順の配列にして返す。 */
  const values = p => COLS.map(c => c[1](p));

  /*
  ** 本人 p が、シーズン season・時代 era・住民番号 no を歩きはじめた。
  ** games と people に1行ずつ足し、この先の記録を p に結び付ける。
  */
  E.walk = (p, season, era, no) => {
    run("INSERT INTO games(season, player, version, era, no, born_at) " +
      "VALUES(?, ?, ?, ?, ?, ?)", [
      season, player, E.VERSION, era, no, new Date().toISOString(),
    ]);
    const game = one("SELECT last_insert_rowid()");
    run(INSERT_PERSON, [game, season, era, no, ...values(p)]);
    ids.set(p, one("SELECT last_insert_rowid()"));
  };

  /* 記録の文を log に足す（歩いている本人のだけ）。 */
  E.hooks.said = (p, text, cls) => {
    const id = ids.get(p);
    if( !id ){
      return;
    }
    run("INSERT INTO log(person, age, text, cls) VALUES(?, ?, ?, ?)", [
      id, p.age, text, cls,
    ]);
  };

  /*
  ** 歩いている本人が選んだ選択肢を picks に足し、道（people.path、
  ** 選択肢の ID をカンマでつないだもの）を延ばし、人の欄を書き戻す。
  ** 選択肢は初めて出たときに options に足す。陥落の選択なら、その時点で
  ** 生きているかを fall_survived に書く。
  */
  E.hooks.pick = (p, dec, o) => {
    const id = ids.get(p);
    if( !id ){
      return;
    }
    run("INSERT OR IGNORE INTO options VALUES(?, ?, ?, ?)", [
      o.id, dec.key, o.t, o.label,
    ]);
    run("INSERT INTO picks(person, age, key, opt) VALUES(?, ?, ?, ?)", [
      id, p.age, dec.key, o.id,
    ]);
    run(
      "UPDATE people SET path = CASE path WHEN '' THEN ? " +
        "ELSE path || ',' || ? END WHERE id = ?",
      [o.id, o.id, id]
    );
    run(UPDATE_PERSON, [...values(p), id]);
    if( dec.alarm ){
      run("UPDATE people SET fall_survived = ? WHERE id = ?", [
        b(p.alive), id,
      ]);
    }
  };

  /* 1年を終えた本人の欄を書き戻す。 */
  E.hooks.year = p => {
    const id = ids.get(p);
    if( id ){
      run(UPDATE_PERSON, [...values(p), id]);
    }
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
  ** 決まった表を埋め直し、この端末のプレイヤーを決めてから E.db を置く。
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
    E.db = db;
    E.player = player;
    return db;
  });

  /* 画面を閉じるときは、予約を待たずに保存する */
  addEventListener("pagehide", save);
})(globalThis.Eridu);
