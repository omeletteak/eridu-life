#!/usr/bin/env node
/*
** 道の共有の API（worker/src/api.js）の点検。手元の Worker に要求を送り、
** 返ってきた答えが決まりどおりかを調べる。表に行を書くので、本番の
** Worker には向けない（手元の wrangler dev だけ）。
**
** 使い方（docs/worker.md）:
**   cd worker && npx wrangler d1 execute DB --local --file schema.sql
**   cd worker && npx wrangler dev
**   node tools/api.js [-n 人数] [URL]     URL の既定は http://localhost:8787
**
** 調べること:
**   - 配られた番号が範囲の中で、生まれる場所を選んだらそこに生まれる
**   - 遊びかけの番号を、ほかの人に重ねて配らない（もう歩かれた番号は別）
**   - 同じ1秒の4人は同じ組の番号で、歩かれていれば、空でない道のうち
**     いちばん早く歩きはじめた人の道が返る
**   - 同じ番号を同じ道で歩いた2人目には ✦ の印（mark）が付かない
**   - 形の合わない要求（版・道・プレイヤー・二重の送信・大きすぎる本文）を断る
**   - ほかの人の一回の同じ1秒には答えない
**   - IP ごとの遊びかけの予約の上限と、1分の回数の制限が効く
**
** 問題があれば1行ずつ出し、終了コードを 1 にする。
*/
require("../js/data.js");
require("../js/sim.js");
const E = globalThis.Eridu;

/* 引数：-n で人数、ほかは Worker の URL */
const args = process.argv.slice(2);
let count = 100;
let base = "http://localhost:8787";
for(let i = 0; i < args.length; i++){
  if( args[i] === "-n" ){
    count = +args[++i];
  }else{
    base = args[i].replace(/\/$/, "");
  }
}

/* 試しに歩かせる道の候補（決まった選択肢の ID） */
const PATHS = [
  [],
  ["school.study"],
  ["school.study", "work.corp"],
  ["school.wild", "work.gang", "proxy.accept"],
];

/* 見つけた問題の一覧 */
const bad = [];

/* 条件 ok が偽なら、問題 what を残す。 */
function expect(ok, what){
  if( !ok ){
    bad.push(what);
  }
}

/* 配列 a から1つを選んで返す。 */
const pick = a => a[Math.floor(Math.random() * a.length)];

/*
** 要求に付ける送り元の IP（CF-Connecting-IP）。本番では Cloudflare が
** 付けるが、手元では付けたものが届くので、回数の制限を人ごとに分けて試す
*/
const RUN = "t" + Date.now();
let ip = RUN;

/*
** API の path に、本文 obj があれば POST で、なければ GET で送り、
** {status, body}（body は JSON を読んだもの）を返す。送り元は ip。
*/
async function call(path, obj){
  const headers = {"CF-Connecting-IP": ip};
  const opt = obj === undefined
    ? {headers}
    : {method: "POST", headers, body: JSON.stringify(obj)};
  const r = await fetch(base + path, opt);
  return {status: r.status, body: await r.json()};
}

/* 番号の答え b（born の応答）の人が生まれる地区の id を返す。 */
function birthOf(b){
  const key = `s${b.season}|v${b.version}|${b.era}|${b.no}`;
  return E.newPerson(b.era, true, null, key).birthD.id;
}

/*
** count 人を生まれさせて歩き終えさせ、上の見出しのことを調べる。
** 半分は生まれる場所を選ぶ。遊びかけの人を少し抱えたまま次を生む。
*/
async function lives(){
  const player = "test-" + Date.now();
  const live = new Map();
  /* この回で歩き終えた番号と、番号と道の組 */
  const done = new Set();
  const routes = new Set();
  /*
  ** 番号ごとの、同じ1秒の人としてたどる道（null は歩かれていない）。
  ** 前の回の行もあるので、初めは peers の答えから知る
  */
  const known = new Map();
  for(let i = 0; i < count; i++){
    ip = RUN + "-" + i;
    const era = pick(["now", "old"]);
    const ds = E.DISTRICTS.filter(d => (era === "old" ? d.old : d.w) > 0);
    const place = Math.random() < 0.5 ? pick(ds).id : "";
    const r = await call("/api/born", {player, era, place, version: E.VERSION});
    expect(r.status === 200, `born ${r.status} ${JSON.stringify(r.body)}`);
    const b = r.body;
    const key = b.season + "|" + b.era + "|" + b.no;
    expect(b.no >= 100000 && b.no <= 999999, `番号が範囲の外：${b.no}`);
    expect(!place || birthOf(b) === place, `${b.no} が ${place} に生まれない`);
    expect(!live.has(key) || done.has(key) || b.reborn, `遊びかけの ${key} を重ねて配った`);
    live.set(key, b);
    const p = await call(`/api/peers?game=${b.game}&player=${player}`);
    expect(p.body.peers.length === 4, `同じ1秒が4人でない：${b.no}`);
    for(const q of p.body.peers){
      const k = b.season + "|" + b.era + "|" + q.no;
      const same = Math.floor((q.no - 100000) / 5) ===
        Math.floor((b.no - 100000) / 5);
      expect(same, `${q.no} が ${b.no} と同じ組でない`);
      if( known.has(k) ){
        expect(String(q.path) === String(known.get(k)),
          `${q.no} の道が違う：${q.path} / ${known.get(k)}`);
      }else{
        known.set(k, q.path);
      }
    }
    /* 3人に1人は遊びかけのまま残し、予約が重ならないかを見る */
    if( Math.random() < 0.3 ){
      continue;
    }
    const path = pick(PATHS);
    const d = await call("/api/died", {
      player, game: b.game, path, age: 40, cause: "テスト",
    });
    expect(d.status === 200, `died ${d.status} ${JSON.stringify(d.body)}`);
    expect(!routes.has(key + "|" + path) || d.body.mark === false,
      `同じ道の2人目に印が付いた：${key}`);
    routes.add(key + "|" + path);
    done.add(key);
    /* 道が空の一回（決断の前に亡くなった）は、たどる道にしない（lab と同じ） */
    if( known.get(key) === null && path.length ){
      known.set(key, path);
    }
    const again = await call("/api/died", {
      player, game: b.game, path, age: 40, cause: "テスト",
    });
    expect(again.status === 409, `二重の送信を受けた：${again.status}`);
  }
}

/* 形の合わない要求を断るかを調べる。 */
async function refusals(){
  const player = "test-bad-" + Date.now();
  let r = await call("/api/born", {player, era: "now", version: -1});
  expect(r.status === 409 && r.body.version === E.VERSION, "違う版を受けた");
  r = await call("/api/born", {player, era: "x", version: E.VERSION});
  expect(r.status === 400, "知らない時代を受けた");
  r = await call("/api/born", {player: "a'", era: "now", version: E.VERSION});
  expect(r.status === 400, "形の合わないプレイヤーを受けた");
  ip = RUN + "-held";
  r = await call("/api/born", {player, era: "now", version: E.VERSION});
  const game = r.body.game;
  r = await call("/api/died", {
    player, game, path: ["x'; DROP TABLE people; --"], age: 1, cause: "a",
  });
  expect(r.status === 400, "形の合わない道を受けた");
  r = await call("/api/died", {
    player: "someone-else", game, path: [], age: 1, cause: "a",
  });
  expect(r.status === 404, "ほかの人の一回を受けた");
  r = await call(`/api/peers?game=${game}&player=someone-else`);
  expect(r.status === 404, "ほかの人の一回の同じ1秒を答えた");
  r = await call("/api/born", {player, pad: "x".repeat(20000)});
  expect(r.status === 413, `大きすぎる本文に 413 を返さない：${r.status}`);
  /* 同じ IP で遊びかけを溜めると断る（さっきの1つを入れて MAX_HELD = 5） */
  const codes = [];
  for(let i = 0; i < 5; i++){
    codes.push((await call("/api/born", {
      player, era: "now", version: E.VERSION,
    })).status);
  }
  expect(String(codes) === "200,200,200,200,429",
    `遊びかけの上限が効かない：${codes}`);
  /* 同じ IP から1分に 10 回を超えると断る */
  ip = RUN + "-fast";
  codes.length = 0;
  for(let i = 0; i < 11; i++){
    codes.push((await call("/api/died", {player, game: 0})).status);
  }
  expect(codes[10] === 429, `回数の制限が効かない：${codes}`);
  r = await call("/api/nothing");
  expect(r.status === 404, "知らない道すじに 404 を返さない");
}

/* 点検を流し、結果を出して終わる。 */
async function main(){
  const before = (await call("/api/season")).body;
  await lives();
  await refusals();
  const after = (await call("/api/season")).body;
  expect(after.version === E.VERSION, `シーズンの版が違う：${after.version}`);
  console.log(`${count}人：シーズン ${after.season}、残り ` +
    `now ${before.left.now}→${after.left.now} / ` +
    `old ${before.left.old}→${after.left.old}`);
  for(const s of bad){
    console.log(s);
  }
  console.log(`問題 ${bad.length}件`);
  process.exit(bad.length ? 1 : 0);
}

main();
