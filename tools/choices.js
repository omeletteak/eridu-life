#!/usr/bin/env node
/* 選択肢の総点検：すべての決断を、選択肢が変わる条件ごとに作り、各選択肢を何千回か試して結果をまとめる
   一括シミュレーション（tools/simulate.js）ではランダムにしか出ない選択肢も、ここでは必ず全部試す

   使い方:
     node tools/choices.js            全部の決断
     node tools/choices.js 旧都       見出しに「旧都」を含む場面だけ
     node tools/choices.js -n 5000    1選択肢あたりの試行回数（初期値 2000）

   出力：場面ごとに、決断の文と、各選択肢の
     死亡率 / 状態値の平均の変化 / 選んだあとの仕事・住所 / 記録に残る文（代表例）
   選択肢の処理でエラーが出たら「エラー」と表示し、最後に件数を出す */
require("../js/data.js");
require("../js/sim.js");
const E=globalThis.Eridu;
const {D,DISTRICTS,JOBS}=E;

const args=process.argv.slice(2);
const ni=args.indexOf("-n");
const TRIALS=ni>=0?parseInt(args[ni+1],10):2000;
const filter=args.filter((a,i)=>a!=="-n"&&args[i-1]!=="-n")[0]||"";

/* ---- 場面を作る道具 ---- */
const dist=id=>DISTRICTS.find(x=>x.id===id);
function person({era="now",d="rokubun",age=20,job="none",married=false,kids=0,money=200,rel=60,hp=70,eth=0,flags={},fallAge=null}={}){
  const p=E.newPerson(era,false); // 記録を残すため isPeer=false
  p.d=dist(d);p.birthD=p.d;p.age=age;p.job=job;p.married=married;p.kids=kids;p.money=money;p.rel=rel;p.hp=hp;p.eth=eth;p.apt=50;
  p.know=50;p.thiren=false; // 18歳の合格の見込みなどが毎回同じになるように固定
  Object.assign(p.flags,flags);
  if(era==="old")p.fallAge=fallAge??age;
  p.log=[];
  return p;
}
const lost={familyLost:1};

/* 選択肢が変わる条件ごとに1つずつ。[見出し, 決断の関数, 人の設定] */
const SCENES=[
  ["15歳 · 進路",D.school,{age:15}],
  ["18歳 · 仕事（ふつう）",D.work,{age:18}],
  ["18歳 · 仕事（走り屋の仲間がいる）",D.work,{age:18,flags:{wild:1}}],
  ["24歳 · 誘い",D.proxy,{age:24}],
  ["29歳 · 家族",D.family,{age:29}],
  ["29歳 · 家族（陥落で家族が消息不明になって2年）",D.family,{era:"old",age:29,fallAge:27,flags:{familyLost:1,fall:1}}],
  ["42歳 · 転機（旧都に店を残してきた）",D.turn,{era:"old",age:42,fallAge:35,d:"camp",job:"shop",money:150,flags:{fall:1,survivor:1,lostShop:1}}],
  ["42歳 · 転機（いまの時代・ルミナスクエア以外）",D.turn,{age:42,money:400}],
  ["42歳 · 転機（いまの時代・ルミナスクエア）",D.turn,{age:42,d:"center",money:400}],
  ["42歳 · 転機（陥落前・旧都の外）",D.turn,{era:"old",age:42,d:"janus",money:400,flags:{}}],
  ["62歳 · 老後",D.retire,{age:62,job:"shop"}],
  ["侵蝕の症状（ホロウレイダー）",D.ether,{age:30,job:"raider",eth:65}],
  ["侵蝕の症状（郊外の店員）",D.ether,{age:40,job:"shop",d:"outer",eth:65}],
  ["侵蝕の症状（ルミナスクエアの引退した人）",D.ether,{age:70,job:"retired",d:"center",eth:65}],
  ["共生ホロウ災害",D.disaster,{age:30}],
  ["共生ホロウ災害（6歳）",D.disaster,{age:6}],
  // 旧都陥落：範囲の中
  ["旧都陥落 · 中 · 5歳",D.fall,{era:"old",d:"kshita",age:5}],
  ["旧都陥落 · 中 · 12歳",D.fall,{era:"old",d:"kshita",age:12}],
  ["旧都陥落 · 中 · 30歳",D.fall,{era:"old",d:"kshita",age:30,job:"shop"}],
  ["旧都陥落 · 中 · 45歳（家族あり・会社員）",D.fall,{era:"old",d:"kshita",age:45,job:"corp",married:true,kids:1,money:800}],
  ["旧都陥落 · 中 · 45歳（ひとり・店主）",D.fall,{era:"old",d:"kshita",age:45,job:"owner",money:800}],
  ["旧都陥落 · 中 · 5歳（家族が消息不明）",D.fall,{era:"old",d:"kshita",age:5,flags:lost}],
  ["旧都陥落 · 中 · 12歳（家族が消息不明）",D.fall,{era:"old",d:"kshita",age:12,flags:lost}],
  ["旧都陥落 · 中 · 30歳（家族が消息不明）",D.fall,{era:"old",d:"kshita",age:30,job:"shop",flags:lost}],
  ["旧都陥落 · 中 · 45歳（家族が消息不明・店主）",D.fall,{era:"old",d:"kshita",age:45,job:"owner",money:800,flags:lost}],
  // 旧都陥落：範囲の外
  ["旧都陥落 · 外 · 5歳",D.fallFar,{era:"old",d:"waifei",age:5}],
  ["旧都陥落 · 外 · 12歳",D.fallFar,{era:"old",d:"waifei",age:12}],
  ["旧都陥落 · 外 · 30歳",D.fallFar,{era:"old",d:"waifei",age:30,job:"shop"}],
  ["旧都陥落 · 外 · 45歳（店主）",D.fallFar,{era:"old",d:"waifei",age:45,job:"owner",money:800}],
  ["旧都陥落 · 外 · 5歳（家族が消息不明）",D.fallFar,{era:"old",d:"outer",age:5,flags:lost}],
  ["旧都陥落 · 外 · 12歳（家族が消息不明）",D.fallFar,{era:"old",d:"outer",age:12,flags:lost}],
  ["旧都陥落 · 外 · 30歳（家族が消息不明）",D.fallFar,{era:"old",d:"outer",age:30,job:"shop",flags:lost}],
];

/* ---- 1つの選択肢を何度も試す ---- */
const KEYS=[["hp","健康"],["hap","幸福"],["rel","人間関係"],["know","知識"],["eth","侵蝕"],["money","貯え"]];
function trial(cfg,optIndex,fn){
  let dead=0,errors=0,firstError=null;
  const sum=Object.fromEntries(KEYS.map(([k])=>[k,0]));
  const jobs={},places={},lines={},causes={};
  for(let i=0;i<TRIALS;i++){
    const p=person(cfg);
    const before=JSON.parse(JSON.stringify(p));
    const dec=fn(p);
    const o=dec.opts[optIndex];
    try{o.fx(p)}catch(e){errors++;firstError=firstError||e;continue}
    for(const [k] of KEYS)sum[k]+=p[k]-before[k];
    if(!p.alive){dead++;causes[p.cause]=(causes[p.cause]||0)+1}
    else{jobs[JOBS[p.job].name]=(jobs[JOBS[p.job].name]||0)+1;places[p.d.name]=(places[p.d.name]||0)+1}
    for(const l of p.log)lines[l.text]=(lines[l.text]||0)+1;
  }
  const n=TRIALS-errors||1;
  const top=(m,k=2)=>Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([x,c])=>`${x}${Object.keys(m).length>1?` ${Math.round(100*c/n)}%`:""}`).join(" / ");
  return {
    dead:dead/n,errors,firstError,
    delta:KEYS.map(([k,label])=>{const v=sum[k]/n;return Math.abs(v)<.5?null:`${label}${v>0?"+":""}${Math.round(v)}`}).filter(Boolean).join(" "),
    jobs:top(jobs),places:top(places),lines:top(lines,3),causes:top(causes,1),
  };
}

/* ---- 実行と出力 ---- */
let total=0,totalErr=0;
const out=[];
for(const [title,fn,cfg] of SCENES){
  if(filter&&!title.includes(filter))continue;
  const dec=fn(person(cfg));
  out.push(`\n■ ${title}`);
  out.push(`  ${dec.text}`);
  dec.opts.forEach((o,i)=>{
    const r=trial(cfg,i,fn);
    total++;totalErr+=r.errors;
    out.push(`  ${i+1}. ${o.label}（${o.sub}）`);
    if(r.errors)out.push(`     エラー ${r.errors}回: ${r.firstError&&r.firstError.message}`);
    out.push(`     死亡率 ${(100*r.dead).toFixed(1)}%${r.dead?`（${r.causes}）`:""}  変化: ${r.delta||"なし"}`);
    if(r.dead<1)out.push(`     その後: 仕事 ${r.jobs} · 住所 ${r.places}`);
    if(r.lines)out.push(`     記録: ${r.lines}`);
  });
}
out.push(`\n合計 ${total}個の選択肢を、各${TRIALS}回試しました。エラー ${totalErr}件。`);
console.log(out.join("\n"));
process.exitCode=totalErr?1:0;
