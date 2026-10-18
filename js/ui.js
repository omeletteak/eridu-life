/* 画面：描画と操作。data.js と sim.js を先に読み込むこと */
(()=>{
const {JOBS,newPerson,say,decisionFor,aptLabel,autoChoose,step,fmt,runToEnd,rnd,skylineSVG,level}=window.Eridu;

let state={era:"now",pace:1000,speed:1};
let me=null, peers=[], timer=null, paused=false, pending=null, ended=false;

const $=id=>document.getElementById(id);
// 開発用：?fall で旧都陥落の前に生まれ、1歳で陥落が来る。?fall=near / ?fall=far で範囲の中か外かを選べる
// &age=45 のように付けると、その年齢で陥落が来る（それまでの年は一気に進める）。&alone=1 で家族がすでに消息不明の状況になる
const QS=new URLSearchParams(location.search);
const DEBUG_FALL=QS.get("fall"),DEBUG_AGE=Math.max(1,parseInt(QS.get("age")||"1",10)||1);

function renderId(){
  const p=me;
  // 転出スタンプは押された直後の1回だけ叩きつける動きをつける
  const slam=p.flags.stampNew;p.flags.stampNew=0;
  // 陥落の範囲外にいた人は、避難民の流入で地区の数値だけ変わる（p.d が別のオブジェクトになる）ので id で比べる
  const moved=p.d.id!==p.birthD.id;
  $("idcard").classList.toggle("slammed",!!slam);
  $("idcard").innerHTML=`
   <div><div class="eyebrow">住民記録 No.${p.no}</div><div class="name">${p.name}</div></div>
   <div class="age">${p.age}<small>歳</small></div>
   <dl>
    <dt>出生</dt><dd>${p.birthD.name} <span class="muted">· ${p.birthD.desc}</span></dd>
    ${moved?`<dt>住所</dt><dd>${p.flags.survivor?`<s class="muted">旧都</s> → `:""}${p.d.name}</dd>`:""}
    <dt>医療</dt><dd>${level(p.d.med)} <span class="muted">· 教育 ${level(p.d.edu)}</span></dd>
    <dt>属性</dt><dd>${p.thiren?p.kind+"のシリオン":"人間"}の${p.sex}</dd>
    <dt>時代</dt><dd>${p.era==="old"?"旧都陥落の前":"いまの新エリー都"}</dd>
    <dt>仕事</dt><dd>${JOBS[p.job].name}${p.proxy?" ＋ 裏稼業":""}</dd>
    <dt>家族</dt><dd>${p.married?"配偶者あり":"ひとり"}${p.kids?"・子ども"+p.kids+"人":""}${p.flags.bangboo?"・ボンプ":""}</dd>
   </dl>
   ${p.flags.survivor?`<div class="stamp move${slam?" slam":""}">転出<small>旧都 → 新エリー都</small></div>`:""}
   ${p.alive?"":`<div class="stamp">${p.age}歳 没</div>`}`;
}
/* 旧都陥落の前はセピアの配色。陥落を生き延びる（範囲の外なら見届ける）と今の新エリー都の配色に移る */
function applyEra(old){
  document.body.classList.toggle("era-old",old);
  $("brand").textContent=old?"Old capital civic record · 非公式ファン作品":"New Eridu civic record · 非公式ファン作品";
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
function renderAll(){applyEra(me.era==="old"&&!me.flags.survivor&&!me.flags.witness);renderId();renderStats();renderLog();renderPeers()}

function showDecision(dec){
  pending=dec;
  const box=$("decision");
  const near=dec.alarm==="near",far=dec.alarm==="far";
  const head=near
    ?`<div class="eyebrow alarm-eyebrow">緊急 · 決断</div><h2 class="alarm-title" data-text="${dec.title}">${dec.title}</h2>`
    :far?`<div class="eyebrow">遠くの空 · 決断</div><h2 class="far-title">${dec.title}</h2>`
    :`<div class="eyebrow">決断</div><h2>${dec.title}</h2>`;
  box.innerHTML=`<div class="card decision${near?" alarm-card":far?" far-card":""}">${head}<p>${dec.text}</p><div class="opts">${dec.opts.map((o,i)=>`<button class="opt" data-i="${i}"><b>${o.label}</b><span>${o.sub}</span></button>`).join("")}</div></div>`;
  const choose=o=>{
    box.innerHTML="";
    o.fx(me);
    if(dec.alarm){me.fallChoice=o.label;me.fallSurvived=me.alive}
    if(dec.alarm&&!me.alive){
      // ホロウが画面ごと飲み込んでから最期の画面へ
      pending={swallow:true};
      return swallowAll(()=>{pending=null;finish()});
    }
    stopAlarm(near?"recede":far?"fade":"");pending=null;
    if(near)me.flags.stampNew=1;
    renderAll();
    if(!me.alive)return finish();
    if(dec.alarm)return fallReport($("decision"),true);
    schedule();
  };
  box.querySelectorAll(".opt").forEach(b=>b.onclick=()=>choose(dec.opts[+b.dataset.i]));
  if(dec.alarm)startAlarm(dec.alarm);
  box.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"nearest"});
}

/* 旧都陥落の演出。右下に出生地区のスカイライン
   mode "near"（範囲の中）：画面の揺れ・赤い明滅・警報テロップ・左下から迫るホロウ
   mode "far"（範囲の外）：揺れも明滅もなく、途切れがちなラジオだけ。ホロウは遠い地平線の上で膨らむ */
const TICKER="緊急警報 ／ 大規模ホロウの急速な拡大を観測 ／ 全市民はただちに避難を開始してください ／ 避難経路は治安局の誘導に従ってください ／ ";
const RADIO="……臨時ニュースです ／ 旧都で大規模なホロウの拡大が…… ／ ……繰り返します ／ 避難してきた方の受け入れ先は…… ／ ……現在、確認中です ／ ";
let alarm=null;
function startAlarm(mode="near"){
  stopAlarm();
  const far=mode==="far";
  const bodyClass=far?"alarm-far":"alarm";
  document.body.classList.add(bodyClass);
  const ticker=document.createElement("div");
  ticker.className="alarm-ticker"+(far?" radio":"");ticker.setAttribute("aria-hidden","true");
  ticker.innerHTML=`<span>${(far?RADIO:TICKER).repeat(4)}</span>`;
  const flash=document.createElement("div");flash.className=far?"":"alarm-flash";
  const hollow=document.createElement("div");hollow.className="hollow"+(far?" far":"");hollow.setAttribute("aria-hidden","true");
  const sky=document.createElement("div");sky.className="skyline";sky.setAttribute("aria-hidden","true");
  sky.innerHTML=skylineSVG(me.birthD.sky,me.no)+`<span class="sky-tag">${me.birthD.name}</span>`;
  document.body.append(sky,hollow,ticker,flash);
  // 次のフレームで動きはじめる（ホロウは隅からゆっくり迫り、街並みは下からせり上がる）
  requestAnimationFrame(()=>requestAnimationFrame(()=>{hollow.classList.add("grow");sky.classList.add("show")}));
  alarm={ticker,flash,hollow,sky};
}
/* mode: "recede" ならホロウが縮んで消え、旧都の街並みも遠ざかる（範囲の中から生き延びた）
         "fade" ならホロウは遠くに残ったまま薄れ、地元の街並みはそのまま沈む（範囲の外で見届けた）
         それ以外はすぐ全部消す */
function stopAlarm(mode){
  clearFxTimers();
  if(!alarm)return;
  alarm.ticker.remove();alarm.flash.remove();
  document.body.classList.remove("alarm","alarm-far");
  const h=alarm.hollow,sky=alarm.sky;
  if(mode==="recede"||mode==="fade"){h.classList.add(mode==="recede"?"recede":"fade");sky.classList.add("leave");setTimeout(()=>{h.remove();sky.remove()},2200)}
  else{h.remove();sky.remove()}
  alarm=null;
}
/* 亡くなったとき：ホロウが画面全体を覆い、しばらく暗いまま、そのあと最期の画面が浮かぶ */
function swallowAll(done){
  if(!alarm)return done();
  const h=alarm.hollow,sky=alarm.sky;
  alarm.ticker.remove();alarm.flash.remove();
  document.body.classList.remove("alarm","alarm-far");
  alarm=null;
  h.classList.add("swallow");
  const quick=matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(()=>{
    done();
    sky.remove();
    h.classList.add("fade");
    setTimeout(()=>h.remove(),1600);
  },quick?600:2600);
}

/* 陥落のあと「他の人たちがどうなったか」を出す
   1. 自分と、同じ1秒に生まれた人たちの選択と安否を一人ずつ
   2. あの日、旧都にいた100人のうち何人が新エリー都に着いたか（D.fall と同じ確率で抽選）
   withButton=true なら最後に「先へ進む」を出し、押すまで年は進まない */
let fxTimers=[];
function clearFxTimers(){fxTimers.forEach(clearTimeout);fxTimers=[]}
function crowdAtFall(n=100){
  const rows=[];
  for(let i=0;i<n;i++){const stay=rnd()<.5;rows.push({stay,lost:rnd()<(stay?.35:.18)})}
  return rows;
}
function fallReport(box,withButton){
  const quick=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const people=[{who:"あなた",q:me,self:true},...peers.filter(q=>q.flags.fall).map(q=>({who:q.name,q}))];
  const crowd=crowdAtFall();
  const order=crowd.map((_,i)=>i).sort(()=>rnd()-.5);
  if(withButton)pending={report:true};
  box.innerHTML=`<div class="card report">
    <div class="eyebrow">安否確認 · 同じ1秒に生まれた人たち</div>
    <div class="peers">${people.map((x,i)=>`<div class="peer${x.self?" self":""}"><span class="who">${x.who}　<span class="muted">${x.q.fallChoice||""}${x.q.flags.familyLost?" · 家族は消息不明":""}</span></span><span class="st checking" id="sf${i}">確認中…</span></div>`).join("")}</div>
    <div class="crowd-head"><span class="eyebrow">あの日、旧都にいた100人</span><span class="crowd-count" id="crowdCount">集計中…</span></div>
    <div class="crowd" id="crowd">${crowd.map((c,i)=>`<i data-i="${i}"></i>`).join("")}</div>
    <p class="muted crowd-legend"><span class="dot ok"></span>新エリー都に着いた　<span class="dot lost"></span>消息不明</p>
    ${withButton?`<div class="row" style="margin-top:12px"><button class="btn" id="reportNext" hidden>先へ進む</button></div>`:""}
  </div>`;
  const first=quick?0:900,gap=quick?0:850;
  people.forEach((x,i)=>fxTimers.push(setTimeout(()=>{
    const el=$("sf"+i);if(!el)return;
    // 最期の画面では4人とも最後まで流したあとなので、陥落した時点の生死を見る
    const ok=x.q.fallSurvived,outside=x.q.birthD.zone!=="inside";
    el.className="st "+(!ok?"lost":outside?"away":"safe");
    el.textContent=!ok?"消息不明":outside?"旧都の外にいた":"無事";
  },first+i*gap)));
  // 100人の点を、ばらばらの順に一つずつ確定させていく
  const cStart=first+people.length*gap+(quick?0:500),dotGap=quick?0:28;
  const dots=box.querySelectorAll(".crowd i");
  let arrived=0,lost=0;
  order.forEach((idx,k)=>fxTimers.push(setTimeout(()=>{
    const c=crowd[idx];
    dots[idx].className=c.lost?"lost":"ok";
    c.lost?lost++:arrived++;
    const cnt=$("crowdCount");
    if(cnt)cnt.textContent=`着いた ${arrived}人 · 消息不明 ${lost}人`;
  },cStart+k*dotGap)));
  if(withButton){
    fxTimers.push(setTimeout(()=>{
      const b=$("reportNext");if(!b)return;
      b.hidden=false;b.focus({preventScroll:true});
      b.onclick=()=>{box.innerHTML="";pending=null;schedule()};
    },cStart+crowd.length*dotGap+600));
  }
}

function tick(){
  if(paused||pending||ended)return;
  step(me);
  for(const q of peers){if(q.alive){step(q);const d=decisionFor(q);if(d){const o=autoChoose(q,d);if(d.alarm){q.fallChoice=o.label;q.fallSurvived=q.alive}}}}
  renderAll();
  if(!me.alive)return finish();
  const dec=decisionFor(me);
  if(dec){showDecision(dec);return}
  schedule();
}
function schedule(){clearTimeout(timer);if(!ended)timer=setTimeout(tick,state.pace/state.speed)}

function finish(){
  ended=true;clearTimeout(timer);stopAlarm();
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
  </div>${p.cause==="旧都陥落"?`<div id="endReport"></div>`:""}`;
  if(p.cause==="旧都陥落")fallReport($("endReport"),false);
  $("againBtn").onclick=()=>{applyEra(state.era==="old");$("end").hidden=true;$("game").hidden=true;$("start").hidden=false;window.scrollTo(0,0)};
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
   :`<p class="muted">まだ記録はありません。例：クロセ ミオ（猫のシリオン） · 郊外 · 47歳 · エーテリアス化</p>`;
}

/* 操作 */
function segBind(id,fn){$(id).querySelectorAll("button").forEach(b=>b.onclick=()=>{$(id).querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x===b));fn(b.dataset.v)})}
segBind("eraSeg",v=>{state.era=v;applyEra(v==="old")});
segBind("paceSeg",v=>state.pace=+v);
/* ネタバレの切り替えは、この端末だけで覚えておく（読めなくても「なし」で動く） */
const SPOILER_KEY="eridu-life-spoiler";
function setSpoiler(on){
  window.Eridu.spoiler=on;
  $("spoilerSeg").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",(b.dataset.v==="on")===on));
  try{localStorage.setItem(SPOILER_KEY,on?"on":"off")}catch(e){}
}
segBind("spoilerSeg",v=>setSpoiler(v==="on"));
try{setSpoiler(localStorage.getItem(SPOILER_KEY)==="on")}catch(e){setSpoiler(false)}
segBind("speedSeg",v=>{state.speed=+v;if(!paused&&!pending)schedule()});
$("pauseBtn").onclick=()=>{paused=!paused;$("pauseBtn").textContent=paused?"再開":"一時停止";if(!paused)schedule()};
$("bornBtn").onclick=()=>{
  stopAlarm();
  // 開発用：URL に ?fall を付けると旧都陥落の前に生まれ、1歳で陥落が来る
  const era=DEBUG_FALL!==null?"old":state.era;
  me=newPerson(era,false);
  if(DEBUG_FALL==="near"||DEBUG_FALL==="far"){
    const want=DEBUG_FALL==="near"?"inside":"outside";
    for(let i=0;i<200&&me.d.zone!==want;i++)me=newPerson(era,false);
  }
  if(DEBUG_FALL!==null){
    // 陥落の前年まで一気に進める（途中の決断はランダムに選ぶ）。途中で亡くなったら、その年齢まで生きる人が出るまで生まれ直す
    const want=DEBUG_FALL==="near"?"inside":DEBUG_FALL==="far"?"outside":null;
    for(let i=0;i<300;i++){
      me.fallAge=DEBUG_AGE;if(QS.has("alone"))me.flags.forceAlone=1;
      while(me.alive&&me.age<DEBUG_AGE-1){step(me);const d=decisionFor(me);if(d)autoChoose(me,d)}
      if(me.alive&&(!want||me.d.zone===want))break;
      me=newPerson(era,false);
    }
  }
  // 同じ1秒に生まれた人どうしで名前が重ならないようにする
  peers=[];
  while(peers.length<4){const q=newPerson(era,true);if(q.name!==me.name&&!peers.some(x=>x.name===q.name))peers.push(q)}
  // 同じ1秒に生まれたので、陥落を迎える年齢も同じ
  for(const q of peers){
    q.fallAge=me.fallAge;
    // 開発用に本人を先に進めた場合は、4人も同じ年齢まで進める
    while(q.alive&&q.age<me.age){step(q);const d=decisionFor(q);if(d)autoChoose(q,d)}
  }
  ended=false;paused=false;pending=null;
  $("pauseBtn").disabled=false;$("pauseBtn").textContent="一時停止";
  $("decision").innerHTML="";
  // 生まれたときの記録は 0歳の先頭に入れる（開発用に年齢を進めた場合も 0歳になるように）
  const born=[{age:0,text:`${me.birthD.name}で、${me.thiren?me.kind+"のシリオンの":""}${me.sex}として生まれた。`,cls:"big"}];
  // 仮設住宅は必ず、六分街は半分くらいが避難民の家庭（六分街は避難民が寄り集まってできた街）
  if(me.birthD.id==="camp"||(me.birthD.id==="rokubun"&&Math.random()<.5))born.push({age:0,text:"両親は旧都から逃れてきた人たちだった。",cls:""});
  me.log.unshift(...born);
  $("start").hidden=true;$("end").hidden=true;$("game").hidden=false;
  renderAll();schedule();window.scrollTo(0,0);
};
renderMemorial();
})();
