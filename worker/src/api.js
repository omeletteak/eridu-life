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
** 受け取らない。受け取った道は sim.js でたどり直して確かめ、年齢や死因は
** 端末から受け取らずに、たどり直した結果を書く。
**
** いたずらへの備え：born と died は、IP ごとに1分の回数を絞る（wrangler.toml
** の LIMITER）。IP ごとの遊びかけの予約も MAX_HELD までにする。空いた番号を
** 探すのは MAX_WINDOWS 回までにし、それで見つからなければ 503 を返す
** （1回の要求の D1 の問い合わせの上限に当たらないように）。IP は
** そのまま残さず、ハッシュの頭だけを games.ip に残す。
**
**   GET  /api/season         今のシーズンと、時代ごとの歩かれていない番号の数
**   POST /api/born           番号を配る（生まれる）。games に1行書いて予約する
**   POST /api/died           歩き終えた道を受け取る。people に1行書く
**   GET  /api/peers?game=N&player=P
**                            同じ1秒の4人の番号と、歩かれていればその道
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
/* 空いた番号を探すとき、一度に表から引く番号の幅と、引く回数の上限 */
const WINDOW = 4000;
const MAX_WINDOWS = 5;
/* 1つの IP が同時に持てる遊びかけの予約の数 */
const MAX_HELD = 5;
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
** 要求 request の本文を、MAX_BODY バイトまで読んで文字列で返す。
** それより大きければ、残りを読まずに null を返す（Content-Length が
** なくても、読みながら数える）。
*/
async function readCapped(request){
  if( !request.body ){
    return "";
  }
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for(;;){
    const {done, value} = await reader.read();
    if( done ){
      break;
    }
    size += value.length;
    if( size > MAX_BODY ){
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for(const u of parts){
    all.set(u, at);
    at += u.length;
  }
  return new TextDecoder().decode(all);
}

/*
** 要求 request の本文を JSON として読んで返す。読めなければ null を
** 返す。大きすぎれば {tooBig: true} を返す。
*/
async function body(request){
  const text = await readCapped(request);
  if( text === null ){
    return {tooBig: true};
  }
  try{
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  }catch(e){
    return null;
  }
}

/*
** 本文の読み取り q（body の答え）が使えないときの応答を返す。使えれば
** null。
*/
function badBody(q){
  if( !q ){
    return fail("body");
  }
  return q.tooBig ? fail("too big", 413) : null;
}

/*
** 要求 request を送ってきた IP（CF-Connecting-IP）の SHA-256 の頭
** 16桁を返す。IP がなければ（手元の wrangler dev）"local"。
*/
async function ipKey(request){
  const ip = request.headers.get("CF-Connecting-IP");
  if( !ip ){
    return "local";
  }
  const h = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode("eridu-life|" + ip));
  return [...new Uint8Array(h)].slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0")).join("");
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
** TRIES 人まで。表から引くのは MAX_WINDOWS 回まで。{found, low, last,
** busy} を返す。found は見つけた番号（なければ 0）、low は見た中で
** 歩かれていない番号のいちばん小さいもの（なければ見た最後の次）、
** last は最後に見た番号、busy は引く回数の上限で止めたとき true。
*/
async function scan(db, s, era, from, place){
  let low = 0;
  let last = from - 1;
  let tries = 0;
  for(let w = 0; from <= s.no_max; from += WINDOW, w++){
    if( w >= MAX_WINDOWS ){
      return {found: 0, low: low || last + 1, last, busy: true};
    }
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
** いちばん小さいものを返す。番号が残っていなければ 0。予約が混んでいて
** 探しきれなければ -1。
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
  return r.busy ? -1 : r.found;
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
async function born(request, env, ip){
  const q = await body(request);
  if( badBody(q) ){
    return badBody(q);
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
  const held = await db.prepare(
    "SELECT count(*) AS n FROM games g WHERE ip = ? AND born_at > ? " +
      "AND NOT EXISTS(SELECT 1 FROM people p WHERE p.game = g.id)"
  ).bind(ip, iso(Date.now() - HOLD)).first();
  if( held.n >= MAX_HELD ){
    return fail("held", 429);
  }
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
  if( no < 0 ){
    return fail("busy", 503);
  }
  const r = await db.prepare(
    "INSERT INTO games(season, player, version, era, no, born_at, ip) " +
      "VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).bind(s.id, q.player, s.version, q.era, no, iso(), ip).run();
  const game = r.meta.last_row_id;
  return json({
    game, season: s.id, version: s.version, era: q.era, no, reborn: again,
  });
}

/* 道 path が、選択肢の ID の配列として形が合っているかを返す。 */
const goodPath = path =>
  Array.isArray(path) && path.length <= MAX_PICKS &&
  path.every(id => typeof id === "string" && OPTION_ID.test(id));

/* 真偽を 0 / 1 にして返す。 */
const b01 = v => (v ? 1 : 0);

/*
** people の欄のうち、たどり直した人 p から書くものと、その値を取り出す
** 関数の組（lab/db.js の COLS と同じ）。
*/
const COLS = [
  ["name", p => p.name],
  ["sex", p => p.sex],
  ["thiren", p => b01(p.thiren)],
  ["kind", p => p.kind],
  ["apt", p => p.apt],
  ["birth_d", p => p.birthD.id],
  ["d", p => p.d.id],
  ["age", p => p.age],
  ["alive", p => b01(p.alive)],
  ["cause", p => p.cause],
  ["hp", p => p.hp],
  ["hap", p => p.hap],
  ["know", p => p.know],
  ["rel", p => p.rel],
  ["eth", p => p.eth],
  ["money", p => p.money],
  ["job", p => p.job],
  ["proxy", p => b01(p.proxy)],
  ["married", p => b01(p.married)],
  ["kids", p => p.kids],
  ["fall_age", p => p.fallAge],
  ["family_lost", p => b01(p.flags.familyLost)],
  ["reunited", p => b01(p.flags.reunited)],
  ["survivor", p => b01(p.flags.survivor)],
  ["witness", p => b01(p.flags.witness)],
  ["lost_shop", p => b01(p.flags.lostShop)],
];
/* COLS を書く people の INSERT 文 */
const INSERT_PERSON =
  "INSERT INTO people(game, season, era, no, path, fall_survived, died_at, " +
  COLS.map(c => c[0]).join(", ") + ") VALUES(?, ?, ?, ?, ?, ?, ?, " +
  COLS.map(() => "?").join(", ") + ")";

/*
** 一回 g（games の行に seasons の no_min を足したもの）の本人を、道 path
** （選択肢の ID の配列）のとおりに sim.js で最期までたどり直す。
** 本人の作り方は lab/fate.js の resident と同じ。道のとおりに選べなかった、
** 道より多く決断が来た、最期まで行かなかったときは null を返す。
** たどれたら {p, fallSurvived}（陥落の決断のあと生きていたか。なければ
** null）を返す。端末と細かい数が違っても、選択・年齢・死因は同じになる
** （#11）ので、表にはこちらの結果を書く。
*/
function relive(g, path){
  const s = {id: g.season, version: g.version, no_min: g.no_min};
  const p = E.newPerson(g.era, false, null, fateKey(s, g.era, g.no));
  if( g.era === "old" ){
    const key = fateKey(s, g.era, "block" + blockStart(s, g.no));
    p.fallAge = E.fallAgeFrom(E.fateRng(key)());
  }
  p.route = path.slice();
  p.routeAt = 0;
  const seen = [];
  let fallSurvived = null;
  E.runToEnd(p, 130, (q, d, o) => {
    seen.push(o.id);
    if( d.alarm ){
      fallSurvived = b01(q.alive);
    }
  });
  if( p.offRoute || p.alive || seen.join(",") !== path.join(",") ){
    return null;
  }
  return {p, fallSurvived};
}

/*
** POST /api/died：本文 {player, game, path} を受け取り、歩き終えた一回を
** people に1行書く。game は born が返した番号で、同じ player のもので
** なければならない。道は sim.js でたどり直し、ありえない道なら 400。
** 年齢・死因などは端末から受け取らず、たどり直した結果を書く。
** 生まれてから、決断1回につき MIN_PICK_MS より早く送ってきたら 400
** （人の手では選べない速さ）。版が変わったあとの一回はたどり直せない
** ので 409。
**
** 同じ番号をまったく同じ道で歩いた人がまだいなければ mark を true に
** して {mark, age, cause} を返す（その道に名前が付いた印。docs/world.md）。
** 印と歩かれた番号の数は、routes と walked に INSERT OR IGNORE して、
** 入ったかどうかで決める（同時に送られても、1人にしか付かず、1回しか
** 数えない）。
*/
async function died(request, env){
  const q = await body(request);
  if( badBody(q) ){
    return badBody(q);
  }
  if( !Number.isInteger(q.game) ){
    return fail("game");
  }
  if( !goodPath(q.path) ){
    return fail("path");
  }
  const db = env.DB;
  const g = await db.prepare(
    "SELECT g.*, s.no_min FROM games g JOIN seasons s ON s.id = g.season " +
      "WHERE g.id = ?"
  ).bind(q.game).first();
  if( !g || g.player !== q.player ){
    return fail("game", 404);
  }
  if( g.version !== E.VERSION ){
    return json({error: "version", version: E.VERSION}, 409);
  }
  const minMs = env.MIN_PICK_MS === undefined ? 1000 : +env.MIN_PICK_MS;
  if( Date.now() - Date.parse(g.born_at) < minMs * q.path.length ){
    return fail("fast");
  }
  const r = relive(g, q.path);
  if( !r ){
    return fail("route");
  }
  const path = q.path.join(",");
  let got;
  try{
    got = await db.batch([
      db.prepare(INSERT_PERSON).bind(
        g.id, g.season, g.era, g.no, path, r.fallSurvived, iso(),
        ...COLS.map(c => c[1](r.p))
      ),
      db.prepare(
        "INSERT OR IGNORE INTO walked(season, era, no) VALUES(?, ?, ?)"
      ).bind(g.season, g.era, g.no),
      db.prepare(
        "INSERT OR IGNORE INTO routes(season, era, no, path) " +
          "VALUES(?, ?, ?, ?)"
      ).bind(g.season, g.era, g.no, path),
    ]);
  }catch(e){
    /* game は UNIQUE なので、同じ一回を2度送ると入らない */
    return fail("done", 409);
  }
  if( got[1].meta.changes ){
    await db.prepare(
      "INSERT INTO marks(season, era, place, low, walked) " +
        "VALUES(?, ?, '', ?, 1) " +
        "ON CONFLICT(season, era, place) DO UPDATE SET walked = walked + 1"
    ).bind(g.season, g.era, g.no_min).run();
  }
  return json({
    mark: got[2].meta.changes > 0, age: r.p.age, cause: r.p.cause,
  });
}

/*
** GET /api/peers?game=N&player=P：born が返した一回 N（プレイヤー P の
** もの。ほかの人の一回には答えない）と同じ組（同じ1秒）の
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
    "SELECT g.season, g.era, g.no, g.player, s.version, s.no_min, s.no_max " +
      "FROM games g JOIN seasons s ON s.id = g.season WHERE g.id = ?"
  ).bind(id).first();
  if( !g || g.player !== url.searchParams.get("player") ){
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
** POST は、本文が大きすぎれば 413、IP ごとの回数を超えたら 429
** （LIMITER がつながっていなければ数えない）。
*/
export async function handle(request, url, env){
  if( !env.DB ){
    return fail("no database", 503);
  }
  const route = request.method + " " + url.pathname;
  const ip = await ipKey(request);
  if( request.method === "POST" ){
    if( +request.headers.get("content-length") > MAX_BODY ){
      return fail("too big", 413);
    }
    if( env.LIMITER ){
      const r = await env.LIMITER.limit({key: route + "|" + ip});
      if( !r.success ){
        return fail("slow", 429);
      }
    }
  }
  switch( route ){
    case "GET /api/season":
      return getSeason(env);
    case "POST /api/born":
      return born(request, env, ip);
    case "POST /api/died":
      return died(request, env);
    case "GET /api/peers":
      return peers(url, env);
  }
  return fail("not found", 404);
}
