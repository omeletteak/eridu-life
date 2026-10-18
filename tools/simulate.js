#!/usr/bin/env node
/* 一括シミュレーション：N人を最期まで回して、寿命分布と死因の割合を出す
   決断は「同じ1秒に生まれた人たち」と同じく、選択肢からランダムに選ぶ

   使い方:
     node tools/simulate.js                 1万人、いまの時代
     node tools/simulate.js -n 50000        人数を変える
     node tools/simulate.js --era old       旧都陥落の前に生まれる
     node tools/simulate.js --seed 42       乱数を固定（調整前後の比較用）
     node tools/simulate.js --json out.json 集計結果を JSON でも保存
*/
require("../js/data.js");
require("../js/sim.js");
const E=globalThis.Eridu;

/* ---- 引数 ---- */
const args=process.argv.slice(2);
const opt=(names,def)=>{for(const n of names){const i=args.indexOf(n);if(i>=0&&i+1<args.length)return args[i+1]}return def};
if(args.includes("-h")||args.includes("--help")){
  console.log("node tools/simulate.js [-n 人数] [--era now|old] [--seed 数値] [--json 出力先]");process.exit(0);
}
const N=parseInt(opt(["-n","--n"],"10000"),10);
const ERA=opt(["--era"],"now");
const SEED=opt(["--seed"],null);
const JSON_OUT=opt(["--json"],null);
const MAX_YEARS=120;

/* シード付き乱数（mulberry32） */
if(SEED!==null){
  let a=(parseInt(SEED,10)>>>0)||1;
  E.setRandom(()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296});
}

/* ---- 実行 ---- */
const lives=[];
const decisionCount={};
const t0=Date.now();
for(let i=0;i<N;i++){
  const p=E.newPerson(ERA,true);
  E.runToEnd(p,MAX_YEARS,(p,d,o)=>{const k=d.title+" → "+o.label;decisionCount[k]=(decisionCount[k]||0)+1});
  lives.push({
    age:p.age,cause:p.alive?"（上限まで生存）":p.cause,
    birth:p.birthD.name,thiren:p.thiren,job:E.JOBS[p.job].name,
    eth:p.eth,ethYears:p.years.filter(x=>x==="e").length,
  });
}
const ms=Date.now()-t0;

/* ---- 集計の道具 ---- */
const mean=a=>a.reduce((s,x)=>s+x,0)/(a.length||1);
const quant=(sorted,q)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))]:NaN;
const pct=(x,n)=>(100*x/n).toFixed(1).padStart(5)+"%";
const bar=(x,max,w=40)=>"█".repeat(Math.round(w*x/(max||1)));
// 全角を2桁として左寄せ
const width=s=>[...s].reduce((w,c)=>w+(c.charCodeAt(0)>0xff?2:1),0);
const padR=(s,n)=>s+" ".repeat(Math.max(0,n-width(s)));
const countBy=(arr,key)=>{const m={};for(const x of arr){const k=key(x);m[k]=(m[k]||0)+1}return Object.entries(m).sort((a,b)=>b[1]-a[1])};

const ages=lives.map(l=>l.age).sort((a,b)=>a-b);
const summary={
  n:N,era:ERA,seed:SEED,
  mean:mean(ages),median:quant(ages,.5),p10:quant(ages,.1),p25:quant(ages,.25),p75:quant(ages,.75),p90:quant(ages,.9),
  min:ages[0],max:ages[ages.length-1],
};

/* ---- 出力 ---- */
const out=[];
const log=s=>out.push(s);
log(`\n新エリー都の一生 · 一括シミュレーション`);
log(`時代: ${ERA==="old"?"旧都陥落の前":"いまの新エリー都"}  人数: ${N.toLocaleString()}  シード: ${SEED??"なし"}  (${ms}ms)\n`);

log(`■ 寿命`);
log(`  平均 ${summary.mean.toFixed(1)}歳 / 中央値 ${summary.median}歳`);
log(`  10% ${summary.p10} · 25% ${summary.p25} · 75% ${summary.p75} · 90% ${summary.p90}  (最短 ${summary.min} · 最長 ${summary.max})`);
for(const a of [5,18,30,50,65,80,90]){
  log(`  ${String(a).padStart(3)}歳まで生きた人 ${pct(ages.filter(x=>x>=a).length,N)}`);
}

log(`\n■ 寿命分布（10歳ごと）`);
const bins=Array(Math.ceil((MAX_YEARS+1)/10)).fill(0);
for(const a of ages)bins[Math.floor(a/10)]++;
const lastBin=bins.reduce((m,x,i)=>x?i:m,0);
const maxBin=Math.max(...bins);
const binRows=[];
for(let i=0;i<=lastBin;i++){
  const label=`${String(i*10).padStart(3)}–${String(i*10+9).padStart(3)}歳`;
  log(`  ${label} ${String(bins[i]).padStart(6)} ${pct(bins[i],N)} ${bar(bins[i],maxBin)}`);
  binRows.push({from:i*10,to:i*10+9,count:bins[i]});
}

log(`\n■ 死因`);
const causes=countBy(lives,l=>l.cause);
const cw=Math.max(...causes.map(([c])=>width(c)));
for(const [c,k] of causes){
  const a=lives.filter(l=>l.cause===c).map(l=>l.age);
  log(`  ${padR(c,cw)} ${String(k).padStart(6)} ${pct(k,N)}  平均 ${mean(a).toFixed(1).padStart(5)}歳  ${bar(k,causes[0][1],30)}`);
}

log(`\n■ 年代別の死因（上位3つ）`);
const ageGroups=[[0,17,"0–17歳"],[18,39,"18–39歳"],[40,64,"40–64歳"],[65,999,"65歳以上"]];
for(const [lo,hi,label] of ageGroups){
  const g=lives.filter(l=>l.age>=lo&&l.age<=hi);
  const top=countBy(g,l=>l.cause).slice(0,3).map(([c,k])=>`${c} ${(100*k/(g.length||1)).toFixed(0)}%`).join(" · ");
  log(`  ${padR(label,10)} ${String(g.length).padStart(6)}人  ${top}`);
}

const groupTable=(title,key)=>{
  log(`\n■ ${title}`);
  const groups=countBy(lives,key);
  const w=Math.max(...groups.map(([g])=>width(g)));
  const rows=[];
  for(const [g,k] of groups){
    const sub=lives.filter(l=>key(l)===g);
    const sa=sub.map(l=>l.age).sort((a,b)=>a-b);
    const eter=sub.filter(l=>l.cause==="エーテリアス化").length;
    log(`  ${padR(g,w)} ${String(k).padStart(6)}人  平均 ${mean(sa).toFixed(1).padStart(5)}歳  中央値 ${String(quant(sa,.5)).padStart(3)}歳  エーテリアス化 ${pct(eter,k)}`);
    rows.push({group:g,count:k,mean:mean(sa),median:quant(sa,.5),etherealRate:eter/k});
  }
  return rows;
};
const byBirth=groupTable("出生地区別",l=>l.birth);
const byKind=groupTable("人間 / シリオン",l=>l.thiren?"シリオン":"人間");
const byJob=groupTable("最後の仕事別",l=>l.job);

log(`\n■ 決断の発生回数（ランダム選択）`);
const decs=Object.entries(decisionCount).sort((a,b)=>a[0].localeCompare(b[0],"ja"));
const dw=Math.max(...decs.map(([k])=>width(k)));
for(const [k,v] of decs)log(`  ${padR(k,dw)} ${String(v).padStart(6)}`);

console.log(out.join("\n")+"\n");

if(JSON_OUT){
  require("fs").writeFileSync(JSON_OUT,JSON.stringify({
    summary,histogram:binRows,
    causes:causes.map(([cause,count])=>({cause,count,share:count/N})),
    byBirth,byKind,byJob,decisions:decisionCount,
  },null,2));
  console.log(`JSON を保存しました: ${JSON_OUT}`);
}
