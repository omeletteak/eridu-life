/*
** lab：遊んだ一生を SQLite（sql.js の in-memory データベース）に置く。
** data.js・sim.js と vendor/sql-wasm.js を先に読み込むこと。
**
** 世界は先に決まっている。シーズン・版・時代・住民番号から、その人の
** 生まれと運命（1年ごとの乱数）が決まり（sim.js の fate）、プレイヤーは
** その中の一本の道（選んだ選択肢の ID の並び）を歩くだけ。ここに残すのは、
** 誰が・いつ・どの番号を・どの道で歩いたか（games と people）と、
** その一生の記録（picks・log）。道は最後の選択まで決まらないので、
** 表に書くのは亡くなったとき（遊びかけの一生は残らない）。同じ1秒の
** 4人は番号から作り直せるので残さない（lab/fate.js）。
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
  ** people の欄のうち、亡くなった人 p から書くものと、その値を取り出す
  ** 関数の組。path と fall_survived は歩きかけの記録から書く。
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

  /*
  ** 歩いている本人のオブジェクトから、歩きかけの記録を引く表。
  ** 記録は {season, era, no, bornAt, picks, log, fallSurvived} で、
  ** 亡くなったときに表へ書く（commit）。それまでは誰の世界にも出ない
  ** （道は最後の選択まで決まらないので）。同じ1秒の4人や開発用に
  ** 作った人は入らない。sim.js の人には欄を足さない
  */
  const walks = new WeakMap();
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
  ** 表にはまだ書かず、歩きかけの記録を作る。
  */
  E.walk = (p, season, era, no) => {
    walks.set(p, {
      season, era, no,
      bornAt: new Date().toISOString(),
      picks: [],
      log: [],
      fallSurvived: null,
    });
  };

  /*
  ** 亡くなった本人 p の歩きかけの記録を表に書く（games・people・
  ** options・picks・log）。同じ番号を前に誰かがまったく同じ道で歩いて
  ** いなければ、p.mark を true にする（その道に名前が付いた印）。
  */
  function commit(p){
    const w = walks.get(p);
    walks.delete(p);
    const path = w.picks.map(x => x.o.id).join(",");
    const seen = one(
      "SELECT count(*) FROM people WHERE season = ? AND era = ? " +
        "AND no = ? AND path = ?",
      [w.season, w.era, w.no, path]
    );
    p.mark = !seen;
    run("INSERT INTO games(season, player, version, era, no, born_at) " +
      "VALUES(?, ?, ?, ?, ?, ?)", [
      w.season, player, E.VERSION, w.era, w.no, w.bornAt,
    ]);
    const game = one("SELECT last_insert_rowid()");
    run(INSERT_PERSON, [game, w.season, w.era, w.no, ...values(p)]);
    const id = one("SELECT last_insert_rowid()");
    run("UPDATE people SET path = ?, fall_survived = ? WHERE id = ?", [
      path, w.fallSurvived, id,
    ]);
    for(const x of w.picks){
      run("INSERT OR IGNORE INTO options VALUES(?, ?, ?, ?)", [
        x.o.id, x.key, x.o.t, x.o.label,
      ]);
      run("INSERT INTO picks(person, age, key, opt) VALUES(?, ?, ?, ?)", [
        id, x.age, x.key, x.o.id,
      ]);
    }
    for(const x of w.log){
      run("INSERT INTO log(person, age, text, cls) VALUES(?, ?, ?, ?)", [
        id, x.age, x.text, x.cls,
      ]);
    }
    save();
  }

  /* 記録の文を、歩いている本人の記録に足す。 */
  E.hooks.said = (p, text, cls) => {
    const w = walks.get(p);
    if( w ){
      w.log.push({age: p.age, text, cls});
    }
  };

  /*
  ** 歩いている本人が選んだ選択肢を記録に足す。陥落の選択なら、その時点で
  ** 生きているかを残す。選んだ結果亡くなったら表に書く。
  */
  E.hooks.pick = (p, dec, o) => {
    const w = walks.get(p);
    if( !w ){
      return;
    }
    w.picks.push({age: p.age, key: dec.key, o});
    if( dec.alarm ){
      w.fallSurvived = b(p.alive);
    }
    if( !p.alive ){
      commit(p);
    }
  };

  /* 1年を終えた本人が亡くなっていたら表に書く。 */
  E.hooks.year = p => {
    if( walks.get(p) && !p.alive ){
      commit(p);
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
