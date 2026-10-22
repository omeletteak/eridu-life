/*
** lab：人の記録を SQLite（sql.js の in-memory データベース）に置く。
** data.js・sim.js と vendor/sql-wasm.js を先に読み込むこと。
**
** Eridu.hooks に関数を入れ、人の生まれ・記録の文・選んだ選択肢・
** 1年の終わりを表に書く。表の意味は docs/schema.md。
** データベースの用意（wasm の読み込み）は非同期なので、用意ができる
** までの書き込みは溜めておき、できたら順に流す。
**
** 用意ができたら Eridu.db（sql.js の Database）を置き、Eridu.dbReady
** （Promise）を解決する。書き込みで起きたエラーはゲームを止めないよう
** 受け止めて、Eridu.dbErrors に溜める。
*/
(function(E){
  /* 表を作る SQL。人が増えても欄は増やさない */
  const SCHEMA = `
PRAGMA foreign_keys = ON;
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
CREATE TABLE games(id INTEGER PRIMARY KEY, era TEXT, born_at TEXT);
CREATE TABLE people(
  id INTEGER PRIMARY KEY,
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
  witness INTEGER, lost_shop INTEGER
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

  /* 真偽を 0 / 1 にして返す。 */
  const b = v => (v ? 1 : 0);

  /*
  ** people の欄（id・game・role・fall_survived を除く）と、人 p から
  ** その値を取り出す関数の組。生まれたときと毎年の書き戻しで使う。
  ** fall_survived は陥落の選択を当てた直後にだけ書く（pick を見る）。
  */
  const COLS = [
    ["no", p => p.no],
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
    "INSERT INTO people(id, game, role, " + NAMES.join(", ") + ") " +
    "VALUES(?, ?, ?, " + NAMES.map(() => "?").join(", ") + ")";
  const UPDATE_PERSON =
    "UPDATE people SET " + NAMES.map(n => n + " = ?").join(", ") +
    " WHERE id = ?";

  /* 人のオブジェクトから people.id を引く表。sim.js の人には欄を足さない */
  const ids = new WeakMap();
  /* 次に配る people.id と、今の games.id */
  let nextPerson = 1;
  let game = 0;
  /* 用意ができた Database。できるまでは null で、書き込みは queue に溜める */
  let db = null;
  const queue = [];
  E.dbErrors = [];

  /*
  ** SQL の sql を値の配列 vals で実行する。用意ができていなければ溜める。
  ** エラーはゲームを止めないよう受け止め、E.dbErrors に文を残す。
  */
  function run(sql, vals){
    if( !db ){
      queue.push([sql, vals]);
      return;
    }
    try{
      db.run(sql, vals);
    }catch(e){
      E.dbErrors.push(e.message + " / " + sql);
    }
  }

  /* 人 p の people の欄の値を、COLS の順の配列にして返す。 */
  const values = p => COLS.map(c => c[1](p));

  /*
  ** 生まれた人を覚えておく。表に入れるのは、初めて記録や選択や1年の
  ** 終わりが来たとき（ensure）。名前が重なって捨てられた候補のように、
  ** 一度も動かなかった人は表に入らない。
  */
  E.hooks.born = p => {
    ids.set(p, 0);
  };

  /*
  ** p がまだ表になければ people に足し、people.id を返す。本人
  ** （isPeer でない人）を足すときは新しい一生（games）を始め、同じ1秒の
  ** 4人はその時点の一生に入れる。
  */
  function ensure(p){
    let id = ids.get(p);
    if( id ){
      return id;
    }
    if( !p.isPeer ){
      game++;
      run("INSERT INTO games VALUES(?, ?, ?)", [
        game, p.era, new Date().toISOString(),
      ]);
    }
    id = nextPerson++;
    ids.set(p, id);
    const role = p.isPeer ? "peer" : "me";
    run(INSERT_PERSON, [id, game, role, ...values(p)]);
    return id;
  }

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

  /* 1年を終えた人の欄を書き戻す。 */
  E.hooks.year = p => {
    run(UPDATE_PERSON, [...values(p), ensure(p)]);
  };

  /* 決まった表（地区・仕事・選択肢の型）を data.js と sim.js から埋める。 */
  function fillFixed(){
    for(const d of E.DISTRICTS){
      db.run("INSERT INTO districts VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        d.id, d.name, d.zone, d.wealth, d.exp, d.crime, d.edu, d.med, d.dis,
      ]);
    }
    for(const [id, j] of Object.entries(E.JOBS)){
      db.run("INSERT INTO jobs VALUES(?, ?, ?, ?, ?, ?)", [
        id, j.name, j.inc, j.eth, j.haz, j.hap,
      ]);
    }
    for(const [id, k] of Object.entries(E.KINDS)){
      db.run("INSERT INTO kinds VALUES(?, ?, ?)", [id, k.name, k.group]);
    }
  }

  /*
  ** wasm を読み込んでデータベースを作る。表を作って決まった表を埋め、
  ** 溜めておいた書き込みを流してから E.db を置く。
  */
  E.dbReady = initSqlJs({locateFile: f => "vendor/" + f}).then(SQL => {
    const d = new SQL.Database();
    d.exec(SCHEMA);
    db = d;
    fillFixed();
    for(const [sql, vals] of queue){
      run(sql, vals);
    }
    queue.length = 0;
    E.db = db;
    return db;
  });
})(globalThis.Eridu);
