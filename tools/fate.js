#!/usr/bin/env node
/*
** 運命の点検：運命を持つ人（newPerson に fate を渡した人。lab で使う）が、
** 同じ fate・同じ選択なら必ず同じ一生になるかを確かめる。
**
** 使い方:
**   node tools/fate.js           各時代 300人
**   node tools/fate.js -n 2000   各時代 2000人
**   node tools/fate.js --golden  版の答え（tools/fate-golden.json）を作り直す
**
** 1人ごとに、
**   1. 歩く：ほかの運命を持つ人4人と、ふだんの乱数を引く処理を間に
**      はさみながら（画面で並走するときのように）最期まで進める。
**      決断は、sim.js の乱数とは別の乱数で選ぶ（プレイヤーの代わり）。
**      選んだ選択肢の ID を道として残す。
**   2. たどる：同じ fate の人を新しく作り、道を p.route に入れて、
**      ひとりで runToEnd する。
** 生まれ・最期の状態・死因・記録の文・選んだ道が1と2で同じかを比べる。
** 違う人がいれば最初の数人を出し、終了コードは 1。
**
** 版の点検：決まった fate の人（各時代 200人）を運命の道で最期まで流し、
** 生まれ・最期の年齢・死因・仕事・住所・子どもの数・道をまとめた
** ハッシュを、tools/fate-golden.json の答えと比べる。
**   - 答えと同じ：動きは変わっていない
**   - 違うのに E.VERSION が答えの版と同じ：動きを変えたのに版を上げ
**     忘れている。終了コード 1（前に歩かれた道が、黙って違う一生になる）
**   - 違い、E.VERSION も上がっている：--golden で答えを作り直すよう出す
** 健康などの細かい数は入れない（ブラウザによって最後の桁が違うことが
** あるため）。記録の文や選択肢のラベルを変えても答えは変わらない。
*/
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("../js/data.js");
require("../js/sim.js");
const E = globalThis.Eridu;
const {newPerson, step, decisionFor, apply, runToEnd} = E;

const args = process.argv.slice(2);
const ni = args.indexOf("-n");
/* 各時代で試す人数 */
const N = ni >= 0 ? parseInt(args[ni + 1], 10) : 300;
/* 版の答えを作り直すか */
const GOLDEN = args.includes("--golden");
/* 版の答えの置き場所 */
const GOLDEN_FILE = path.join(__dirname, "fate-golden.json");

/* プレイヤーの代わりに選ぶための乱数（sim.js の流れとは別） */
const player = E.fateRng("player");

/* p の一生を、比べられる文字列にして返す。 */
function snapshot(p, route){
  return JSON.stringify({
    name: p.name,
    birth: p.birthD.id,
    thiren: p.thiren,
    apt: p.apt,
    age: p.age,
    cause: p.cause,
    d: p.d.id,
    job: p.job,
    hp: p.hp,
    hap: p.hap,
    eth: p.eth,
    money: p.money,
    kids: p.kids,
    flags: p.flags,
    log: p.log.map(x => x.age + ":" + x.text),
    route,
  });
}

/*
** fate の人を、ほかの運命を持つ人とふだんの乱数をはさみながら最期まで
** 歩かせ、[最期の文字列, 道] を返す。fallAge は同じ1秒の5人で揃える。
*/
function walk(era, fate, fallAge){
  const p = newPerson(era, false, null, fate);
  p.fallAge = fallAge;
  const others = [1, 2, 3, 4].map(k => {
    const q = newPerson(era, true, null, fate + "/other" + k);
    q.fallAge = fallAge;
    return q;
  });
  const route = [];
  let guard = 0;
  while( p.alive && guard++ < 130 ){
    step(p);
    /* 画面の演出などで、ふだんの乱数が間に引かれる */
    E.rnd();
    for(const q of others){
      if( q.alive ){
        step(q);
        const d = decisionFor(q);
        if( d ){
          E.autoChoose(q, d);
        }
      }
    }
    E.rnd();
    const dec = decisionFor(p);
    if( dec ){
      const o = dec.opts[Math.floor(player() * dec.opts.length)];
      apply(p, dec, o);
      route.push(o.id);
    }
  }
  return [snapshot(p, route), route];
}

/* fate の人を道 route のとおりにひとりで最期までたどり、最期の文字列を返す。 */
function replay(era, fate, fallAge, route){
  const p = newPerson(era, false, null, fate);
  p.fallAge = fallAge;
  p.route = route;
  p.routeAt = 0;
  const seen = [];
  runToEnd(p, 130, (q, d, o) => seen.push(o.id));
  const off = p.offRoute ? " (道から外れた)" : "";
  return snapshot(p, seen) + off;
}

let bad = 0;
for(const era of ["now", "old"]){
  for(let i = 0; i < N; i++){
    const fate = "check|" + era + "|" + i;
    const fallAge =
      era === "old" ? E.fallAgeFrom(E.fateRng(fate + "|fall")()) : null;
    const [a, route] = walk(era, fate, fallAge);
    const b = replay(era, fate, fallAge, route);
    if( a !== b ){
      bad++;
      if( bad <= 3 ){
        console.log("違う一生：" + fate);
        console.log("  歩いた " + a.slice(0, 400));
        console.log("  たどった " + b.slice(0, 400));
      }
    }
  }
}
console.log(
  `各時代 ${N}人を歩かせ、道をたどり直しました。違ったのは ${bad}人。`
);

/*
** 決まった fate の人を運命の道で最期まで流し、比べる欄をまとめた
** ハッシュ（sha256 の16進）を返す。
*/
function fingerprint(){
  const h = crypto.createHash("sha256");
  for(const era of ["now", "old"]){
    for(let i = 0; i < 200; i++){
      const fate = "golden|" + era + "|" + i;
      const p = newPerson(era, true, null, fate);
      if( era === "old" ){
        p.fallAge = E.fallAgeFrom(E.fateRng(fate + "|fall")());
      }
      const route = [];
      runToEnd(p, 130, (q, d, o) => route.push(o.id));
      h.update(
        [
          p.name, p.birthD.id, p.thiren, p.age, p.cause, p.job, p.d.id,
          p.kids, route.join(","),
        ].join("|") + "\n"
      );
    }
  }
  return h.digest("hex");
}

const now = {version: E.VERSION, hash: fingerprint()};
let old = null;
try{
  old = JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"));
}catch(e){}
if( GOLDEN || !old ){
  fs.writeFileSync(GOLDEN_FILE, JSON.stringify(now, null, 2) + "\n");
  console.log(`版 ${now.version} の答えを ${GOLDEN_FILE} に書きました。`);
}else if( old.hash === now.hash ){
  console.log(`版 ${now.version}：動きは答えと同じです。`);
}else if( old.version === now.version ){
  console.log(
    `動きが答えと違うのに、E.VERSION が ${now.version} のままです。` +
      "js/sim.js の E.VERSION を上げてから --golden で答えを作り直して" +
      "ください（上げないと、前に歩かれた道が黙って違う一生になります）。"
  );
  bad++;
}else{
  console.log(
    `版が ${old.version} から ${now.version} に上がり、動きも変わりました。` +
      "node tools/fate.js --golden で答えを作り直してください。"
  );
  bad++;
}
process.exitCode = bad ? 1 : 0;
