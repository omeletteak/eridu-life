/* 画面：描画と操作。data.js と sim.js を先に読み込むこと */
(()=>{
const {JOBS,newPerson,say,decisionFor,aptLabel,autoChoose,step,fmt,runToEnd}=window.Eridu;

let state={era:"now",pace:1000,speed:1};
let me=null, peers=[], timer=null, paused=false, pending=null, ended=false;

const $=id=>document.getElementById(id);

function renderId(){
  const p=me;
  $("idcard").innerHTML=`
   <div><div class="eyebrow">住民記録 No.${p.no}</div><div class="name">${p.name}</div></div>
   <div class="age">${p.age}<small>歳</small></div>
   <dl>
    <dt>出生</dt><dd>${p.d.name} <span class="muted">· ${p.d.desc}</span></dd>
    <dt>属性</dt><dd>${p.thiren?p.kind+"のシリオン":"人間"}の${p.sex}</dd>
    <dt>時代</dt><dd>${p.era==="old"?"旧都陥落の前":"いまの新エリー都"}</dd>
    <dt>仕事</dt><dd>${JOBS[p.job].name}${p.proxy?" ＋ 裏稼業":""}</dd>
    <dt>家族</dt><dd>${p.married?"配偶者あり":"ひとり"}${p.kids?"・子ども"+p.kids+"人":""}${p.flags.bangboo?"・ボンプ":""}</dd>
   </dl>
   ${p.alive?"":`<div class="stamp">${p.age}歳 没</div>`}`;
}
function renderStats(){
  const p=me;
  const s=(k,v,cls="")=>`<div class="stat ${cls}"><div class="top"><span>${k}</span><span class="num">${Math.round(v)}</span></div><div class="bar"><i style="width:${v}%"></i></div></div>`;
  $("stats").innerHTML=s("健康",p.hp)+s("幸福",p.hap)+s("知識",p.know)+s("人間関係",p.rel)+s("侵蝕度",p.eth,"ether")
   +`<div class="stat"><div class="top"><span>エーテル適性</span><span class="num">${p.age>=18?aptLabel(p.apt):"未検査"}</span></div><div class="bar"><i style="width:${p.age>=18?p.apt:0}%"></i></div></div>`
   +`<div class="money"><span>貯え</span><b>${fmt(p.money)}</b></div>`;
}
function renderLog(){
  $("log").innerHTML=me.log.slice().reverse().map(l=>`<li class="${l.cls}"><span class="y">${l.age}歳</span><span class="t">${l.text}</span></li>`).join("");
}
function renderPeers(){
  $("peers").innerHTML=peers.map(q=>`<div class="peer ${q.alive?"":"dead"}"><span class="who">${q.name}　<span class="muted">${q.d.name}・${q.thiren?q.kind+"のシリオン":"人間"}</span></span><span class="st">${q.alive?q.age+"歳 · "+JOBS[q.job].name:q.age+"歳 "+q.cause}</span></div>`).join("");
}
function renderAll(){renderId();renderStats();renderLog();renderPeers()}

function showDecision(dec){
  pending=dec;
  const box=$("decision");
  box.innerHTML=`<div class="card decision"><div class="eyebrow">決断</div><h2>${dec.title}</h2><p>${dec.text}</p><div class="opts">${dec.opts.map((o,i)=>`<button class="opt" data-i="${i}"><b>${o.label}</b><span>${o.sub}</span></button>`).join("")}</div></div>`;
  box.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{
    const o=dec.opts[+b.dataset.i];pending=null;box.innerHTML="";
    o.fx(me);renderAll();
    if(!me.alive)return finish();
    schedule();
  });
  box.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"nearest"});
}

function tick(){
  if(paused||pending||ended)return;
  step(me);
  for(const q of peers){if(q.alive){step(q);const d=decisionFor(q);if(d)autoChoose(q,d)}}
  renderAll();
  if(!me.alive)return finish();
  const dec=decisionFor(me);
  if(dec){showDecision(dec);return}
  schedule();
}
function schedule(){clearTimeout(timer);if(!ended)timer=setTimeout(tick,state.pace/state.speed)}

function finish(){
  ended=true;clearTimeout(timer);
  // 残りの人たちを最後まで流す
  for(const q of peers)runToEnd(q);
  renderAll();
  const p=me;
  const longer=peers.filter(q=>q.age>p.age).length;
  $("end").hidden=false;
  $("end").innerHTML=`<div class="card ending">
    <div class="eyebrow">最期の記録</div>
    <h2>${p.name}、${p.age}歳</h2>
    <div class="cause">${p.cause}</div>
    <p>${p.d.name}で${p.thiren?p.kind+"のシリオン":"人間"}として生まれ、最後の仕事は「${JOBS[p.job].name}」でした。最期の侵蝕度は${Math.round(p.eth)}、幸福は${Math.round(p.hap)}。同じ1秒に生まれた4人のうち、あなたより長く生きたのは${longer}人です。</p>
    <div class="lifemap" aria-label="人生地図。1マスが1年">${Array.from({length:Math.max(100,p.years.length)},(_,i)=>`<i class="${p.years[i]||""}"></i>`).join("")}</div>
    <p class="muted" style="font-size:12px;margin-top:6px">1マス＝1年。紫は侵蝕度60以上で過ごした年。</p>
    <div class="row" style="margin-top:14px"><button class="btn" id="againBtn">もう一度生まれる</button></div>
  </div>`;
  $("againBtn").onclick=()=>{$("end").hidden=true;$("game").hidden=true;$("start").hidden=false;window.scrollTo(0,0)};
  saveMemorial(p);renderMemorial();
  $("pauseBtn").disabled=true;
  $("end").scrollIntoView({block:"start"});
}

/* 前世の記録 */
const KEY="eridu-life-memorial";
function loadMem(){try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){return[]}}
function saveMemorial(p){try{const m=loadMem();m.unshift({n:p.name,a:p.age,c:p.cause,d:p.d.name,t:p.thiren?p.kind+"のシリオン":"人間"});localStorage.setItem(KEY,JSON.stringify(m.slice(0,10)))}catch(e){}}
function renderMemorial(){
  const m=loadMem();
  $("memorial").innerHTML=m.length?m.map(x=>`<div><span>${x.n}（${x.t}）</span><span>${x.d} · ${x.a}歳 · ${x.c}</span></div>`).join("")
   :`<p class="muted">まだ記録はありません。例：クロセ ミオ（猫のシリオン） · 外環 · 47歳 · エーテリアス化</p>`;
}

/* 操作 */
function segBind(id,fn){$(id).querySelectorAll("button").forEach(b=>b.onclick=()=>{$(id).querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));fn(b.dataset.v)})}
segBind("eraSeg",v=>state.era=v);
segBind("paceSeg",v=>state.pace=+v);
segBind("speedSeg",v=>{state.speed=+v;if(!paused&&!pending)schedule()});
$("pauseBtn").onclick=()=>{paused=!paused;$("pauseBtn").textContent=paused?"再開":"一時停止";if(!paused)schedule()};
$("bornBtn").onclick=()=>{
  me=newPerson(state.era,false);
  peers=[0,1,2,3].map(()=>newPerson(state.era,true));
  ended=false;paused=false;pending=null;
  $("pauseBtn").disabled=false;$("pauseBtn").textContent="一時停止";
  $("decision").innerHTML="";
  say(me,`${me.d.name}で、${me.thiren?me.kind+"のシリオンの":""}${me.sex}として生まれた。`,"big");
  if(me.d.id==="camp")say(me,"両親は旧都から逃れてきた人たちだった。");
  $("start").hidden=true;$("end").hidden=true;$("game").hidden=false;
  renderAll();schedule();window.scrollTo(0,0);
};
renderMemorial();
})();
