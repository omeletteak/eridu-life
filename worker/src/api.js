/*
** lab の道を共有する API（/api/…）。表は worker/schema.sql、考え方は
** docs/world.md、使い方は docs/worker.md。
**
** 世界は先に決まっている。シーズン・版・時代・住民番号から、その人の
** 生まれと運命が決まる（sim.js の fate）。ここでは、番号を配り、
** 亡くなった人の道を受け取り、同じ1秒の人の道を返す。番号の配り方は
** lab/fate.js と同じ決まりで、それをサーバーの1か所でやる。
**
** SQL はここで組み、値はいつもプレースホルダで渡す。端末から SQL は
** 受け取らない。受け取った道は今は形だけを確かめる（たどり直しはまだ）。
**
**   GET  /api/season         今のシーズンと、時代ごとの歩かれていない番号の数
**   POST /api/born           番号を配る（生まれる）。games に1行書いて予約する
**   POST /api/died           歩き終えた道を受け取る。people に1行書く
**   GET  /api/peers?game=N   同じ1秒の4人の番号と、歩かれていればその道
*/
import E from "./eridu.js";

/* 住民番号の範囲（lab/fate.js と同じ6桁） */
const NO_MIN = 100000;
const NO_MAX = 999999;
/* 同じ1秒に生まれる人数（本人を含む） */
const BLOCK = 5;
/* もう誰かが歩いた番号に生まれる割合（lab/fate.js の REBORN） */
const REBORN = 0.2;
/*
** 番号の予約が切れるまでの時間（ミリ秒）。遊びかけの番号は、この間は
** ほかの人に配らない。切れたら、また歩かれていない番号として配る
*/
const HOLD = 2 * 60 * 60 * 1000;
/*
** 生まれる場所に合う番号を探すとき、運命を作ってみる数の上限。
** Worker の CPU の枠に収めるため（1人 10 マイクロ秒ほど）。lab は 3000
*/
const TRIES = 300;
/* 空いた番号を探すとき、一度に表から引く番号の幅 */
const WINDOW = 4000;
/* 歩かれた番号から選ぶとき、一度に引く数 */
const SAMPLE = 50;
/* 受け取る本文の大きさの上限（バイト） */
const MAX_BODY = 16384;
/* 道に入れられる選択の数の上限 */
const MAX_PICKS = 200;
/* 選択肢の ID の形（"決断.名前"。docs/sim.md） */
const OPTION_ID = /^[A-Za-z]+\.[A-Za-z]+$/;
/* プレイヤーの id の形（lab/db.js が作る乱数の UUID など） */
const PLAYER_ID = /^[A-Za-z0-9-]{8,64}$/;
/* 時代の一覧 */
const ERAS = ["now", "old"];
/* 死因の文字数の上限 */
const MAX_CAUSE = 40;

/* 今の時刻（ミリ秒 ms）を ISO の文字列で返す。ms がなければ今。 */
const iso = ms => new Date(ms === undefined ? Date.now() : ms).toISOString();

/* 値 obj を JSON の応答にして、状態 status（既定は 200）で返す。 */
function json(obj, status){
  return new Response(JSON.stringify(obj) + "\n", {
    status: status || 200,
    headers: {"content-type": "application/json; charset=utf-8"}
  });
}

/* 理由 why のエラーを、状態 status の JSON の応答にして返す。 */
const fail = (why, status) => json({error: why}, status || 400);

/*
** 要求 request の本文を JSON として読んで返す。大きすぎる、または
** 読めなければ null を返す。
*/
async function body(request){
  const text = await request.text();
  if( text.length > MAX_BODY ){
    return null;
  }
  try{
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  }catch(e){
    return null;
  }
}

/* シーズン s・時代 era・番号 no の人の運命の名前（lab/fate.js と同じ）を返す。 */
const fateKey = (s, era, no) => `s${s.id}|v${s.version}|${era}|${no}`;

/* シーズン s で、番号 no が入る組の最初の番号を返す。 */
const blockStart = (s, no) =>
  s.no_min + Math.floor((no - s.no_min) / BLOCK) * BLOCK;

/*
** シーズン s・時代 era の番号 no の人が、地区 place に生まれるかを返す
** （place が "" なら true）。lab/fate.js の fits と同じく、同じ1秒の
** 人として運命から作ってみる。
*/
function fits(s, era, no, place){
  if( !place ){
    return true;
  }
  const p = E.newPerson(era, true, null, fateKey(s, era, no));
  return p.birthD.id === place;
}

/* データベース db から、いちばん新しいシーズンの行を返す（なければ null）。 */
const latest = db =>
  db.prepare("SELECT * FROM seasons ORDER BY id DESC LIMIT 1").first();

/*
** データベース db に次のシーズンを作り、その行を返す。prev（今の
** シーズンの行）があれば終わった時刻を書く。行は消さない。同時に
** 2つの要求が来ても1つしか作らないよう、prev より新しい行が
** あれば足さない。
*/
async function newSeason(db, prev){
  const t = iso();
  const last = prev ? prev.id : 0;
  const stmts = [];
  if( prev ){
    stmts.push(db.prepare(
      "UPDATE seasons SET ended_at = ? WHERE id = ? AND ended_at IS NULL"
    ).bind(t, prev.id));
  }
  stmts.push(db.prepare(
    "INSERT INTO seasons(version, no_min, no_max, started_at) " +
      "SELECT ?, ?, ?, ? WHERE NOT EXISTS(SELECT 1 FROM seasons WHERE id > ?)"
  ).bind(E.VERSION, NO_MIN, NO_MAX, t, last));
  await db.batch(stmts);
  return latest(db);
}

/*
** データベース db の今のシーズンの行を返す。ない、または版が今の
** sim.js（E.VERSION）と違えば、次のシーズンを始める。
*/
async function season(db){
  const s = await latest(db);
  return s && s.version === E.VERSION ? s : newSeason(db, s);
}

/*
** シーズン s・時代 era・生まれる場所 place（"" はどこでも）の目印
** {low, walked} を返す（worker/schema.sql の marks）。まだ行がなければ
** {low: s.no_min, walked: 0}。
*/
async function mark(db, s, era, place){
  const m = await db.prepare(
    "SELECT low, walked FROM marks WHERE season = ? AND era = ? AND place = ?"
  ).bind(s.id, era, place).first();
  return m || {low: s.no_min, walked: 0};
}

/*
** シーズン s・時代 era・生まれる場所 place の目印の low を、low まで
** 進める（戻しはしない）。
*/
const setLow = (db, s, era, place, low) => db.prepare(
  "INSERT INTO marks(season, era, place, low, walked) VALUES(?, ?, ?, ?, 0) " +
    "ON CONFLICT(season, era, place) DO UPDATE SET low = max(low, excluded.low)"
).bind(s.id, era, place, low).run();

/*
** シーズン s・時代 era の番号 from〜to のうち、歩かれた番号の集まりと、
** 予約中（遊びかけで、予約が切れていない）の番号の集まりを
** {walked, held}（どちらも Set）にして返す。
*/
async function takenIn(db, s, era, from, to){
  const since = iso(Date.now() - HOLD);
  const [a, b] = await db.batch([
    db.prepare(
      "SELECT DISTINCT no FROM people " +
        "WHERE season = ? AND era = ? AND no BETWEEN ? AND ?"
    ).bind(s.id, era, from, to),
    db.prepare(
      "SELECT no FROM games g " +
        "WHERE season = ? AND era = ? AND no BETWEEN ? AND ? " +
        "AND born_at > ? " +
        "AND NOT EXISTS(SELECT 1 FROM people p WHERE p.game = g.id)"
    ).bind(s.id, era, from, to, since),
  ]);
  return {
    walked: new Set(a.results.map(r => r.no)),
    held: new Set(b.results.map(r => r.no)),
  };
}

/*
** シーズン s・時代 era の番号 from から順に、歩かれても予約されても
** いない番号を探す。place（"" ならどこでも）に生まれるものが見つかったら
** found に入れて止める。place があるときは、運命を作ってみるのは
** TRIES 人まで。{found, low, last} を返す。found は見つけた番号（なければ
** 0）、low は見た中で歩かれていない番号のいちばん小さいもの（なければ
** 見た最後の次）、last は最後に見た番号。
*/
async function scan(db, s, era, from, place){
  let low = 0;
  let last = from - 1;
  let tries = 0;
  for(; from <= s.no_max; from += WINDOW){
    const to = Math.min(from + WINDOW - 1, s.no_max);
    const t = await takenIn(db, s, era, from, to);
    for(let n = from; n <= to; n++){
      last = n;
      if( !low && !t.walked.has(n) ){
        low = n;
      }
      if( t.walked.has(n) || t.held.has(n) ){
        continue;
      }
      if( fits(s, era, n, place) ){
        return {found: n, low, last};
      }
      tries++;
      if( tries >= TRIES ){
        return {found: 0, low, last};
      }
    }
  }
  return {found: 0, low: low || last + 1, last};
}

/*
** シーズン s・時代 era で、歩かれても予約されてもいない番号のうち
** いちばん小さいものを返す。番号が残っていなければ 0。
**
** place があれば、そこに生まれる番号を先に探す（なければ場所は見ない）。
** 場所を選ぶ人が多いと、小さい番号のあたりには選ばれにくい地区の番号
** ばかりが残るので、場所ごとの目印から探しはじめる（目印より前の、
** その場所に生まれる番号は、もう配った）。予約が切れて空いた番号が
** 目印より前にあっても、場所を選んだ人には配らない（どこでもよい人に配る）。
**
** 目印の low（歩かれていない番号のいちばん小さいもの）が進んでいたら
** 書き直す。
*/
async function firstFree(db, s, era, place){
  const m = await mark(db, s, era, "");
  if( place ){
    const mp = await mark(db, s, era, place);
    const r = await scan(db, s, era, Math.max(m.low, mp.low), place);
    await setLow(db, s, era, place, r.found || r.last);
    if( r.found ){
      return r.found;
    }
  }
  const r = await scan(db, s, era, m.low, "");
  if( r.low > m.low ){
    await setLow(db, s, era, "", r.low);
  }
  return r.found;
}

/*
** シーズン s・時代 era で、もう歩かれた番号のうち、地区 place に生まれる
** ものを1つ選んで返す（place が "" ならどこでも）。歩かれた番号の
** 範囲から場所を1つ選び、そこから SAMPLE 個を引いて、その中から選ぶ。
** 合うものがなければ 0。
*/
async function reborn(db, s, era, place){
  const top = await db.prepare(
    "SELECT max(no) AS top FROM people WHERE season = ? AND era = ?"
  ).bind(s.id, era).first();
  if( !top || top.top === null ){
    return 0;
  }
  const r = s.no_min + Math.floor(Math.random() * (top.top - s.no_min + 1));
  const got = await db.prepare(
    "SELECT DISTINCT no FROM people WHERE season = ? AND era = ? " +
      "AND no >= ? ORDER BY no LIMIT ?"
  ).bind(s.id, era, r, SAMPLE).all();
  const list = got.results.map(x => x.no).filter(n => fits(s, era, n, place));
  return list.length ? list[Math.floor(Math.random() * list.length)] : 0;
}

/*
** GET /api/season：今のシーズンの番号・版と、時代ごとの歩かれていない
** 番号の数を返す。シーズンがなければ始める。
*/
async function getSeason(env){
  const s = await season(env.DB);
  const size = s.no_max - s.no_min + 1;
  const left = {};
  for(const era of ERAS){
    left[era] = size - (await mark(env.DB, s, era, "")).walked;
  }
  return json({season: s.id, version: s.version, left});
}

/*
** POST /api/born：本文 {player, era, place, version} を受け取り、番号を
** 配る。version は端末の sim.js の版で、今と違えば 409 で今の版を返す
** （端末の読み込み直しが要る）。番号は lab/fate.js と同じ決まりで選び、
** games に1行書いて予約する。{game, season, version, era, no, reborn} を
** 返す。reborn は、もう誰かが歩いた番号に生まれたとき true（点検用。
** 画面では区別しない）。
** 端末は season・version・era・no から運命の名前を作り、本人を作る。
*/
async function born(request, env){
  const q = await body(request);
  if( !q ){
    return fail("body");
  }
  if( typeof q.player !== "string" || !PLAYER_ID.test(q.player) ){
    return fail("player");
  }
  if( !ERAS.includes(q.era) ){
    return fail("era");
  }
  const place = q.place || "";
  if( place && !E.DISTRICTS.some(d => d.id === place) ){
    return fail("place");
  }
  if( q.version !== E.VERSION ){
    return json({error: "version", version: E.VERSION}, 409);
  }
  const db = env.DB;
  let s = await season(db);
  let no = 0;
  if( (await mark(db, s, q.era, "")).walked && Math.random() < REBORN ){
    no = await reborn(db, s, q.era, place);
  }
  const again = no > 0;
  if( !no ){
    no = await firstFree(db, s, q.era, place);
  }
  if( !no ){
    s = await newSeason(db, s);
    no = await firstFree(db, s, q.era, place);
  }
  const r = await db.prepare(
    "INSERT INTO games(season, player, version, era, no, born_at) " +
      "VALUES(?, ?, ?, ?, ?, ?)"
  ).bind(s.id, q.player, s.version, q.era, no, iso()).run();
  const game = r.meta.last_row_id;
  return json({
    game, season: s.id, version: s.version, era: q.era, no, reborn: again,
  });
}

/*
** 道 path が、選択肢の ID の配列として形が合っているかを返す
** （中身が本当にありうる道かは、まだ確かめない）。
*/
const goodPath = path =>
  Array.isArray(path) && path.length <= MAX_PICKS &&
  path.every(id => typeof id === "string" && OPTION_ID.test(id));

/*
** POST /api/died：本文 {player, game, path, age, cause} を受け取り、
** 歩き終えた一回を people に1行書く。game は born が返した番号で、
** 同じ player のものでなければならない。同じ番号をまったく同じ道で
** 歩いた人がまだいなければ mark を true にして {mark} を返す
** （その道に名前が付いた印。docs/world.md）。
*/
async function died(request, env){
  const q = await body(request);
  if( !q ){
    return fail("body");
  }
  if( !Number.isInteger(q.game) ){
    return fail("game");
  }
  if( !goodPath(q.path) ){
    return fail("path");
  }
  if( !Number.isInteger(q.age) || q.age < 0 || q.age > 150 ){
    return fail("age");
  }
  if( typeof q.cause !== "string" || q.cause.length > MAX_CAUSE ){
    return fail("cause");
  }
  const db = env.DB;
  const g = await db.prepare(
    "SELECT g.*, s.no_min FROM games g JOIN seasons s ON s.id = g.season " +
      "WHERE g.id = ?"
  ).bind(q.game).first();
  if( !g || g.player !== q.player ){
    return fail("game", 404);
  }
  const path = q.path.join(",");
  const seen = await db.prepare(
    "SELECT count(*) AS n, coalesce(sum(path = ?), 0) AS same " +
      "FROM people WHERE season = ? AND era = ? AND no = ?"
  ).bind(path, g.season, g.era, g.no).first();
  const stmts = [db.prepare(
    "INSERT INTO people(game, season, era, no, path, age, alive, cause, " +
      "died_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?)"
  ).bind(g.id, g.season, g.era, g.no, path, q.age, q.cause, iso())];
  if( !seen.n ){
    stmts.push(db.prepare(
      "INSERT INTO marks(season, era, place, low, walked) " +
        "VALUES(?, ?, '', ?, 1) " +
        "ON CONFLICT(season, era, place) DO UPDATE SET walked = walked + 1"
    ).bind(g.season, g.era, g.no_min));
  }
  try{
    await db.batch(stmts);
  }catch(e){
    /* game は UNIQUE なので、同じ一回を2度送ると入らない */
    return fail("done", 409);
  }
  return json({mark: !seen.same});
}

/*
** GET /api/peers?game=N：born が返した一回 N と同じ組（同じ1秒）の
** 4人の番号を返す。誰かが歩き終えた番号なら、いちばん早く歩きはじめた
** 人の道を path（選択肢の ID の配列）に入れる。歩かれていなければ
** path は null（端末が運命の選ぶ道を行かせる）。
** {season, version, era, peers: [{no, path}]} を返す。
*/
async function peers(url, env){
  const id = Number(url.searchParams.get("game"));
  if( !Number.isInteger(id) ){
    return fail("game");
  }
  const db = env.DB;
  const g = await db.prepare(
    "SELECT g.season, g.era, g.no, s.version, s.no_min, s.no_max " +
      "FROM games g JOIN seasons s ON s.id = g.season WHERE g.id = ?"
  ).bind(id).first();
  if( !g ){
    return fail("game", 404);
  }
  const s = {id: g.season, version: g.version, no_min: g.no_min};
  const start = blockStart(s, g.no);
  const end = Math.min(start + BLOCK - 1, g.no_max);
  const got = await db.prepare(
    "SELECT no, path FROM people WHERE season = ? AND era = ? " +
      "AND no BETWEEN ? AND ? AND path != '' ORDER BY game"
  ).bind(g.season, g.era, start, end).all();
  const first = new Map();
  for(const r of got.results){
    if( !first.has(r.no) ){
      first.set(r.no, r.path.split(","));
    }
  }
  const out = [];
  for(let n = start; n <= end; n++){
    if( n !== g.no ){
      out.push({no: n, path: first.get(n) || null});
    }
  }
  return json({season: g.season, version: g.version, era: g.era, peers: out});
}

/*
** /api/ で始まる要求 request（URL は url）を、道すじと方法で上の
** 処理に振り分けて応答を返す。D1 がつながっていなければ 503。
*/
export async function handle(request, url, env){
  if( !env.DB ){
    return fail("no database", 503);
  }
  const route = request.method + " " + url.pathname;
  switch( route ){
    case "GET /api/season":
      return getSeason(env);
    case "POST /api/born":
      return born(request, env);
    case "POST /api/died":
      return died(request, env);
    case "GET /api/peers":
      return peers(url, env);
  }
  return fail("not found", 404);
}
