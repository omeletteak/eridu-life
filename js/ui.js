/*
** 画面：描画と操作、前世の記録。
** data.js・sim.js・skyline.js を先に読み込むこと。
*/
(() => {
  const {
    DISTRICTS,
    outlook,
    JOBS,
    newPerson,
    say,
    decisionFor,
    aptLabel,
    autoChoose,
    apply,
    step,
    fmt,
    runToEnd,
    rnd,
    skylineSVG,
    level,
  } = window.Eridu;

  /*
  ** スタート画面で選んだ設定。era は時代、pace は1年の長さ（ミリ秒）、
  ** speed はプレイ中の倍速、place は生まれる地区の id（"" ならランダム）。
  */
  let state = {era: "now", pace: 1000, speed: 1, place: ""};

  let me = null; /* 自分 */
  let peers = []; /* 同じ1秒に生まれた4人 */
  let timer = null; /* 次の1年へ進めるタイマー */
  let paused = false; /* 一時停止中か */
  /*
  ** 年を進めずに待っているもの。表示中の決断、陥落の報告
  ** （{report: true}）、ホロウに飲まれる演出（{swallow: true}）のどれか。
  */
  let pending = null;
  let ended = false; /* 最期の画面を出したか */

  /* id の要素を返す。 */
  const $ = id => document.getElementById(id);

  /*
  ** 開発用：?fall で旧都陥落の前に生まれ、1歳で陥落が来る。
  ** ?fall=near / ?fall=far で範囲の中か外かを選べる。
  ** &age=45 のように付けると、その年齢で陥落が来る（それまでの年は一気に
  ** 進める）。&alone=1 で家族がすでに消息不明の状況になる。
  */
  const QS = new URLSearchParams(location.search);
  const DEBUG_FALL = QS.get("fall"),
    DEBUG_AGE = Math.max(1, parseInt(QS.get("age") || "1", 10) || 1);

  /* 自分が人間かシリオンか（「猫のシリオン」「人間」）を返す。 */
  const kindOf = p => (p.thiren ? p.kind + "のシリオン" : "人間");

  /*
  ** 住民票（名前・年齢・出生・住所・医療と教育・属性・時代・仕事・家族）を
  ** 描く。陥落を生き延びた人には「転出」、亡くなった人には「没」の
  ** スタンプを押す。
  */
  function renderId(){
    const p = me;
    /* 転出スタンプは押された直後の1回だけ叩きつける動きをつける */
    const slam = p.flags.stampNew;
    p.flags.stampNew = 0;
    /*
    ** 陥落の範囲外にいた人は、避難民の流入で地区の数値だけ変わる
    ** （p.d が別のオブジェクトになる）ので id で比べる
    */
    const moved = p.d.id !== p.birthD.id;
    const from = p.flags.survivor ? `<s class="muted">旧都</s> → ` : "";
    const addr = moved ? `<dt>住所</dt><dd>${from}${p.d.name}</dd>` : "";
    const era = p.era === "old" ? "旧都陥落の前" : "いまの新エリー都";
    const job = JOBS[p.job].name + (p.proxy ? " ＋ 裏稼業" : "");
    const family =
      (p.married ? "配偶者あり" : "ひとり") +
      (p.kids ? "・子ども" + p.kids + "人" : "") +
      (p.flags.bangboo ? "・ボンプ" : "");
    const dest = p.d.id === "outer" ? "郊外" : "新エリー都";
    const moveStamp = p.flags.survivor
      ? `<div class="stamp move${slam ? " slam" : ""}">` +
        `転出<small>旧都 → ${dest}</small></div>`
      : "";
    const deathStamp = p.alive ? "" : `<div class="stamp">${p.age}歳 没</div>`;
    /*
    ** 住民番号は、亡くなるまで存在ごと出さない（同じ番号に生まれ直しても
    ** 気付かないように）
    */
    const head = p.alive ? "住民記録" : "住民記録 No." + p.no;
    $("idcard").classList.toggle("slammed", !!slam);
    $("idcard").innerHTML = `
   <div><div class="eyebrow">${head}</div><div class="name">${p.name}</div></div>
   <div class="age">${p.age}<small>歳</small></div>
   <dl>
    <dt>出生</dt><dd>${p.birthD.name} <span class="muted">· ${p.birthD.desc}</span></dd>
    ${addr}
    <dt>医療</dt><dd>${level(p.d.med)} <span class="muted">· 教育 ${level(p.d.edu)}</span></dd>
    <dt>属性</dt><dd>${kindOf(p)}の${p.sex}</dd>
    <dt>時代</dt><dd>${era}</dd>
    <dt>仕事</dt><dd>${job}</dd>
    <dt>家族</dt><dd>${family}</dd>
   </dl>
   ${moveStamp}
   ${deathStamp}`;
  }

  /*
  ** 配色を時代に合わせる。old なら旧都陥落の前のセピアの配色、そうで
  ** なければ今の新エリー都の配色。陥落を生き延びる（範囲の外なら
  ** 見届ける）と今の配色に移る。
  */
  function applyEra(old){
    document.body.classList.toggle("era-old", old);
    $("brand").textContent = old
      ? "Eridu civic record · 非公式ファン作品"
      : "New Eridu civic record · 非公式ファン作品";
  }

  /*
  ** 状態値のメーターを描く。エーテル適性は18歳の検査までは「未検査」。
  */
  function renderStats(){
    const p = me;
    /* 名前 k・値 v（0〜100）のメーター1本の HTML を返す。 */
    const bar = (k, num, v, cls) =>
      `<div class="stat${cls}"><div class="top"><span>${k}</span>` +
      `<span class="num">${num}</span></div>` +
      `<div class="bar"><i style="width:${v}%"></i></div></div>`;
    const s = (k, v, cls = "") => bar(k, Math.round(v), v, " " + cls);
    const tested = p.age >= 18;
    const apt = tested ? aptLabel(p.apt) : "未検査";
    $("stats").innerHTML =
      s("健康", p.hp) +
      s("幸福", p.hap) +
      s("知識", p.know) +
      s("人間関係", p.rel) +
      s("侵蝕度", p.eth, "ether") +
      bar("エーテル適性", apt, tested ? p.apt : 0, "") +
      `<div class="money"><span>貯え</span><b>${fmt(p.money)}</b></div>`;
  }

  /* 人生の記録を新しい順に描く。 */
  function renderLog(){
    $("log").innerHTML = me.log
      .slice()
      .reverse()
      .map(
        l =>
          `<li class="${l.cls}"><span class="y">${l.age}歳</span>` +
          `<span class="t">${l.text}</span></li>`
      )
      .join("");
  }

  /*
  ** 同じ1秒に生まれた4人の今を描く（生きていれば年齢と仕事、
  ** 亡くなっていれば死因）。q.tag があれば名前の後ろに添える
  ** （lab で、ほかのプレイヤーの一生だと示すため）。
  */
  function renderPeers(){
    $("peers").innerHTML = peers
      .map(q => {
        const now = q.alive
          ? q.age + "歳 · " + JOBS[q.job].name
          : q.age + "歳 " + q.cause;
        const tag = q.tag ? `<span class="tag">${q.tag}</span>` : "";
        return (
          `<div class="peer ${q.alive ? "" : "dead"}">` +
          `<span class="who">${q.name}${tag}　` +
          `<span class="muted">${q.d.name}・${kindOf(q)}</span></span>` +
          `<span class="st">${now}</span></div>`
        );
      })
      .join("");
  }

  /* 画面全体（配色・住民票・状態値・記録・4人）を今の状態で描き直す。 */
  function renderAll(){
    applyEra(me.era === "old" && !me.flags.survivor && !me.flags.witness);
    renderId();
    renderStats();
    renderLog();
    renderPeers();
  }

  /*
  ** 決断 dec（sim.js の decisionFor が返すもの）を出し、選ばれるまで年を
  ** 進めない。旧都陥落（dec.alarm）なら警報の演出も始める。
  */
  function showDecision(dec){
    pending = dec;
    const box = $("decision");
    const near = dec.alarm === "near",
      far = dec.alarm === "far";
    const head = near
      ? `<div class="eyebrow alarm-eyebrow">緊急 · 決断</div>` +
        `<h2 class="alarm-title" data-text="${dec.title}">${dec.title}</h2>`
      : far
        ? `<div class="eyebrow">遠くの空 · 決断</div>` +
          `<h2 class="far-title">${dec.title}</h2>`
        : `<div class="eyebrow">決断</div><h2>${dec.title}</h2>`;
    const cls = near ? " alarm-card" : far ? " far-card" : "";
    const opts = dec.opts
      .map(
        (o, i) =>
          `<button class="opt" data-i="${i}">` +
          `<b>${o.label}</b><span>${o.sub}</span></button>`
      )
      .join("");
    box.innerHTML =
      `<div class="card decision${cls}">${head}<p>${dec.text}</p>` +
      `<div class="opts">${opts}</div></div>`;
    /*
    ** 選択肢 o が選ばれた。o.fx を当て、陥落なら選択と安否を残す。
    ** 陥落で亡くなればホロウに飲まれる演出のあと最期の画面へ、生き延びれば
    ** 報告を出す。そうでなければ次の年へ。
    */
    const choose = o => {
      box.innerHTML = "";
      apply(me, dec, o);
      if( dec.alarm ){
        me.fallChoice = o.label;
        me.fallSurvived = me.alive;
      }
      if( dec.alarm && !me.alive ){
        /* ホロウが画面ごと飲み込んでから最期の画面へ */
        pending = {swallow: true};
        return swallowAll(() => {
          pending = null;
          finish();
        });
      }
      stopAlarm(near ? "recede" : far ? "fade" : "");
      pending = null;
      if( near ){
        me.flags.stampNew = 1;
      }
      renderAll();
      if( !me.alive ){
        return finish();
      }
      if( dec.alarm ){
        return fallReport($("decision"), true);
      }
      schedule();
    };
    box
      .querySelectorAll(".opt")
      .forEach(b => (b.onclick = () => choose(dec.opts[+b.dataset.i])));
    if( dec.alarm ){
      startAlarm(dec.alarm);
    }
    box.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }

  /* ===== 旧都陥落の演出 ===== */

  /* 範囲の中で流す警報のテロップ */
  const TICKER =
    "緊急警報 ／ 大規模ホロウの急速な拡大を観測 ／ 全市民はただちに避難を開始してください ／ 避難経路は治安局の誘導に従ってください ／ ";
  /* 範囲の外で流す、途切れがちなラジオのテロップ */
  const RADIO =
    "……臨時ニュースです ／ 旧都で大規模なホロウの拡大が…… ／ ……繰り返します ／ 避難してきた方の受け入れ先は…… ／ ……現在、確認中です ／ ";
  /* 演出中の要素（ticker / flash / hollow / sky）。演出していなければ null */
  let alarm = null;

  /*
  ** 旧都陥落の演出を始める。右下に出生地区のスカイラインを出す。
  **
  **   mode "near"（範囲の中）  画面の揺れ・赤い明滅・警報テロップ・
  **                            左下から迫るホロウ
  **   mode "far"（範囲の外）   揺れも明滅もなく、途切れがちなラジオだけ。
  **                            ホロウは遠い地平線の上で膨らむ
  */
  function startAlarm(mode = "near"){
    stopAlarm();
    const far = mode === "far";
    const bodyClass = far ? "alarm-far" : "alarm";
    document.body.classList.add(bodyClass);
    const ticker = document.createElement("div");
    ticker.className = "alarm-ticker" + (far ? " radio" : "");
    ticker.setAttribute("aria-hidden", "true");
    ticker.innerHTML = `<span>${(far ? RADIO : TICKER).repeat(4)}</span>`;
    const flash = document.createElement("div");
    flash.className = far ? "" : "alarm-flash";
    const hollow = document.createElement("div");
    hollow.className = "hollow" + (far ? " far" : "");
    hollow.setAttribute("aria-hidden", "true");
    const sky = document.createElement("div");
    sky.className = "skyline";
    sky.setAttribute("aria-hidden", "true");
    sky.innerHTML =
      skylineSVG(me.birthD.sky, me.no) +
      `<span class="sky-tag">${me.birthD.name}</span>`;
    document.body.append(sky, hollow, ticker, flash);
    /*
    ** 次のフレームで動きはじめる
    ** （ホロウは隅からゆっくり迫り、街並みは下からせり上がる）
    */
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        hollow.classList.add("grow");
        sky.classList.add("show");
      })
    );
    alarm = {ticker, flash, hollow, sky};
  }

  /*
  ** 旧都陥落の演出を止める。報告のタイマーも止める。
  **
  **   mode "recede"  ホロウが縮んで消え、旧都の街並みも遠ざかる
  **                  （範囲の中から生き延びた）
  **   mode "fade"    ホロウは遠くに残ったまま薄れ、地元の街並みは
  **                  そのまま沈む（範囲の外で見届けた）
  **   それ以外       すぐ全部消す
  */
  function stopAlarm(mode){
    clearFxTimers();
    if( !alarm ){
      return;
    }
    alarm.ticker.remove();
    alarm.flash.remove();
    document.body.classList.remove("alarm", "alarm-far");
    const h = alarm.hollow,
      sky = alarm.sky;
    if( mode === "recede" || mode === "fade" ){
      h.classList.add(mode === "recede" ? "recede" : "fade");
      sky.classList.add("leave");
      setTimeout(() => {
        h.remove();
        sky.remove();
      }, 2200);
    }else{
      h.remove();
      sky.remove();
    }
    alarm = null;
  }

  /*
  ** 陥落で亡くなったときの演出。ホロウが画面全体を覆い、しばらく暗い
  ** まま、そのあと done を呼んで最期の画面を浮かばせる。演出していな
  ** ければすぐ done を呼ぶ。
  */
  function swallowAll(done){
    if( !alarm ){
      return done();
    }
    const h = alarm.hollow,
      sky = alarm.sky;
    alarm.ticker.remove();
    alarm.flash.remove();
    document.body.classList.remove("alarm", "alarm-far");
    alarm = null;
    h.classList.add("swallow");
    const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(
      () => {
        done();
        sky.remove();
        h.classList.add("fade");
        setTimeout(() => h.remove(), 1600);
      },
      quick ? 600 : 2600
    );
  }

  /* ===== 陥落のあとの報告 ===== */

  /* 報告を少しずつ出すためのタイマー */
  let fxTimers = [];

  /* 報告のタイマーをすべて止める。 */
  function clearFxTimers(){
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
  }

  /* ms ミリ秒後に fn を呼ぶ。clearFxTimers で止められる。 */
  function later(fn, ms){
    fxTimers.push(setTimeout(fn, ms));
  }

  /*
  ** あの日、旧都にいた n 人のその後を抽選して返す。各要素は
  ** {stay: 残って人を助けたか, lost: 消息不明になったか}。
  ** 確率は D.fall と同じ。
  */
  function crowdAtFall(n = 100){
    const rows = [];
    for(let i = 0; i < n; i++){
      const stay = rnd() < 0.5;
      rows.push({stay, lost: rnd() < (stay ? 0.35 : 0.18)});
    }
    return rows;
  }
  /*
  ** 陥落のあと「他の人たちがどうなったか」を box に出す。
  **
  **   1. 自分と、同じ1秒に生まれた人たちの選択と安否を一人ずつ
  **   2. あの日、旧都にいた100人のうち何人が新エリー都に着いたか
  **
  ** withButton=true なら最後に「先へ進む」を出し、押すまで年は進まない。
  */
  function fallReport(box, withButton){
    const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const people = [
      {who: "あなた", q: me, self: true},
      ...peers.filter(q => q.flags.fall).map(q => ({who: q.name, q})),
    ];
    const crowd = crowdAtFall();
    const order = crowd.map((_, i) => i).sort(() => rnd() - 0.5);
    if( withButton ){
      pending = {report: true};
    }
    const rows = people
      .map((x, i) => {
        const lost = x.q.flags.familyLost ? " · 家族は消息不明" : "";
        const tag = x.q.tag ? `<span class="tag">${x.q.tag}</span>` : "";
        return (
          `<div class="peer${x.self ? " self" : ""}">` +
          `<span class="who">${x.who}${tag}　` +
          `<span class="muted">${x.q.fallChoice || ""}${lost}</span></span>` +
          `<span class="st checking" id="sf${i}">確認中…</span></div>`
        );
      })
      .join("");
    const dots = crowd.map((c, i) => `<i data-i="${i}"></i>`).join("");
    const next = withButton
      ? `<div class="row" style="margin-top:12px">` +
        `<button class="btn" id="reportNext" hidden>先へ進む</button></div>`
      : "";
    box.innerHTML = `<div class="card report">
    <div class="eyebrow">安否確認 · 同じ1秒に生まれた人たち</div>
    <div class="peers">${rows}</div>
    <div class="crowd-head"><span class="eyebrow">あの日、旧都にいた100人</span><span class="crowd-count" id="crowdCount">集計中…</span></div>
    <div class="crowd" id="crowd">${dots}</div>
    <p class="muted crowd-legend"><span class="dot ok"></span>新エリー都に着いた　<span class="dot lost"></span>消息不明</p>
    ${next}
  </div>`;
    const first = quick ? 0 : 900,
      gap = quick ? 0 : 850;
    people.forEach((x, i) =>
      later(() => {
        const el = $("sf" + i);
        if( !el ){
          return;
        }
        /*
        ** 最期の画面では4人とも最後まで流したあとなので、
        ** 陥落した時点の生死を見る
        */
        const ok = x.q.fallSurvived,
          outside = x.q.birthD.zone !== "inside";
        el.className = "st " + (!ok ? "lost" : outside ? "away" : "safe");
        el.textContent = !ok ? "消息不明" : outside ? "旧都の外にいた" : "無事";
      }, first + i * gap)
    );
    /* 100人の点を、ばらばらの順に一つずつ確定させていく */
    const cStart = first + people.length * gap + (quick ? 0 : 500),
      dotGap = quick ? 0 : 28;
    const dotEls = box.querySelectorAll(".crowd i");
    let arrived = 0,
      lost = 0;
    order.forEach((idx, k) =>
      later(() => {
        const c = crowd[idx];
        dotEls[idx].className = c.lost ? "lost" : "ok";
        c.lost ? lost++ : arrived++;
        const cnt = $("crowdCount");
        if( cnt ){
          cnt.textContent = `着いた ${arrived}人 · 消息不明 ${lost}人`;
        }
      }, cStart + k * dotGap)
    );
    if( withButton ){
      later(() => {
        const b = $("reportNext");
        if( !b ){
          return;
        }
        b.hidden = false;
        b.focus({preventScroll: true});
        b.onclick = () => {
          box.innerHTML = "";
          pending = null;
          schedule();
        };
      }, cStart + crowd.length * dotGap + 600);
    }
  }

  /* ===== 年の進行 ===== */

  /*
  ** 1年進める。自分と4人を step で進め、4人の決断はランダムに選ぶ。
  ** 自分が亡くなれば最期の画面へ、決断があれば出して止まる。なければ
  ** 次の1年を予約する。一時停止中・決断の途中・最期のあとは何もしない。
  */
  function tick(){
    if( paused || pending || ended ){
      return;
    }
    step(me);
    for(const q of peers){
      if( q.alive ){
        stepPeer(q);
      }
    }
    renderAll();
    if( !me.alive ){
      return finish();
    }
    const dec = decisionFor(me);
    if( dec ){
      showDecision(dec);
      return;
    }
    schedule();
  }

  /*
  ** 同じ1秒に生まれた人 q を1年進める。step して、決断が来たら
  ** ランダムに選び（lab で前に誰かが歩いた人なら、その道をたどる）、
  ** 陥落なら選択と安否を残す。
  */
  function stepPeer(q){
    step(q);
    const d = decisionFor(q);
    if( d ){
      const o = autoChoose(q, d);
      if( d.alarm ){
        q.fallChoice = o.label;
        q.fallSurvived = q.alive;
      }
    }
  }

  /* 次の1年を、1年の長さ ÷ 倍速 ミリ秒後に予約する。 */
  function schedule(){
    clearTimeout(timer);
    if( !ended ){
      timer = setTimeout(tick, state.pace / state.speed);
    }
  }

  /*
  ** 最期の画面を出す。4人を最後まで流し、自分の一生のまとめと人生地図を
  ** 描き、前世の記録に残す。陥落で亡くなったときは下に報告も出す。
  */
  function finish(){
    ended = true;
    clearTimeout(timer);
    stopAlarm();
    /* 残りの人たちを最後まで流す */
    for(const q of peers){
      runToEnd(q);
    }
    renderAll();
    const p = me;
    const longer = peers.filter(q => q.age > p.age).length;
    const job = JOBS[p.job].name;
    const eth = Math.round(p.eth);
    const hap = Math.round(p.hap);
    /*
    ** p.mark があれば（lab で、誰も歩いていない道を歩き終えたとき）、
    ** 住民番号の横に小さな印を出す。意味は説明しない
    */
    const mark = p.mark ? `<span class="mark" aria-hidden="true">✦</span>` : "";
    /* 人生地図。1マスが1年で、100年に満たなくても100マス出す */
    const map = Array.from(
      {length: Math.max(100, p.years.length)},
      (_, i) => `<i class="${p.years[i] || ""}"></i>`
    ).join("");
    $("end").hidden = false;
    $("end").innerHTML = `<div class="card ending">
    <div class="eyebrow">最期の記録 · No.${p.no}${mark}</div>
    <h2>${p.name}、${p.age}歳</h2>
    <div class="cause">${p.cause}</div>
    <p>${p.d.name}で${kindOf(p)}として生まれ、最後の仕事は「${job}」でした。最期の侵蝕度は${eth}、幸福は${hap}。同じ1秒に生まれた4人のうち、あなたより長く生きたのは${longer}人です。</p>
    <div class="lifemap" aria-label="人生地図。1マスが1年">${map}</div>
    <p class="muted" style="font-size:12px;margin-top:6px">1マス＝1年。紫は侵蝕度60以上で過ごした年。</p>
    <div class="row" style="margin-top:14px"><button class="btn" id="againBtn">もう一度生まれる</button></div>
  </div>${p.cause === "旧都陥落" ? `<div id="endReport"></div>` : ""}`;
    if( p.cause === "旧都陥落" ){
      fallReport($("endReport"), false);
    }
    $("againBtn").onclick = () => {
      applyEra(state.era === "old");
      $("end").hidden = true;
      $("game").hidden = true;
      $("start").hidden = false;
      window.scrollTo(0, 0);
    };
    saveMemorial(p);
    renderMemorial();
    $("pauseBtn").disabled = true;
    $("end").scrollIntoView({block: "start"});
  }

  /* ===== 前世の記録 ===== */

  /* 前世の記録を置く localStorage のキー。直近10件を新しい順に入れる */
  const KEY = "eridu-life-memorial";

  /* 前世の記録を読んで返す。読めなければ空の配列。 */
  function loadMem(){
    try{
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    }catch(e){
      return [];
    }
  }

  /*
  ** p の一生を前世の記録の先頭に足す。各要素は {n: 名前, a: 年齢,
  ** c: 死因, d: 最期の地区, t: 人間かシリオンか, no: 住民番号,
  ** m: 最期の印があったか}。書けなければ何もしない。
  */
  function saveMemorial(p){
    try{
      const m = loadMem();
      m.unshift({
        n: p.name,
        a: p.age,
        c: p.cause,
        d: p.d.name,
        t: kindOf(p),
        no: p.no,
        m: !!p.mark,
      });
      localStorage.setItem(KEY, JSON.stringify(m.slice(0, 10)));
    }catch(e){}
  }

  /*
  ** 文字列 s を HTML に入れられるように置き換えて返す（& < > " '）。
  ** 前世の記録のように localStorage から読んだものを出すときに使う
  ** （書き換えられていても、HTML として動かないように）。
  */
  const esc = s =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  /* 前世の記録を描く。localStorage から読んだ値はすべて esc を通す。 */
  function renderMemorial(){
    const m = loadMem();
    $("memorial").innerHTML = m.length
      ? m
          .map(x => {
            /* 住民番号と印は、あとから足したので古い記録にはない */
            const no = x.no ? `No.${esc(x.no)} · ` : "";
            const mark = x.m ? `<span class="mark" aria-hidden="true">✦</span>` : "";
            const who = `${esc(x.n)}（${esc(x.t)}）`;
            const end = `${esc(x.d)} · ${esc(x.a)}歳 · ${esc(x.c)}`;
            return (
              `<div><span>${who}${mark}</span>` +
              `<span>${no}${end}</span></div>`
            );
          })
          .join("")
      : `<p class="muted">まだ記録はありません。例：クロセ ミオ（猫のシリオン） · 郊外 · 47歳 · エーテリアス化</p>`;
  }

  /* ===== 操作 ===== */

  /*
  ** 切り替えボタンの並び id を、押されたボタンだけ aria-pressed にして、
  ** そのボタンの data-v で fn を呼ぶようにする。
  */
  function segBind(id, fn){
    const buttons = $(id).querySelectorAll("button");
    buttons.forEach(b => {
      b.onclick = () => {
        buttons.forEach(x => x.setAttribute("aria-pressed", x === b));
        fn(b.dataset.v);
      };
    });
  }

  /*
  ** 「生まれる場所」の選択肢を、今の時代に生まれられる地区で作り直す。
  ** 先頭はランダム。続けて暮らしの見込み（outlook）の良い順に、印を
  ** 付けて並べる。陥落で飲まれる範囲かどうかは出さない（見込みにも
  ** 陥落は入っていない）。選んでいた地区がその時代になければランダムに
  ** 戻す。
  */
  function renderPlaces(){
    const old = state.era === "old";
    const ok = DISTRICTS.filter(d => (old ? d.old : d.w) > 0);
    if( !ok.some(d => d.id === state.place) ){
      state.place = "";
    }
    /* 地区 d の option の HTML を返す。 */
    const opt = d => {
      const sel = d.id === state.place ? " selected" : "";
      const mark = outlook(d).mark;
      return `<option value="${d.id}"${sel}>${mark} ${d.name}</option>`;
    };
    const sorted = ok.slice().sort((a, b) => outlook(b).s - outlook(a).s);
    const places = sorted.map(opt).join("");
    const random = state.place ? "" : " selected";
    $("placeSel").innerHTML =
      `<option value=""${random}>ランダム（運に任せる）</option>` + places;
    renderPlaceNote();
  }

  /*
  ** 選んだ地区の説明と医療・教育の水準、暮らしの見込みを選択肢の下に
  ** 出す。ランダムなら、生まれやすさと印の意味を出す。
  */
  function renderPlaceNote(){
    const d = DISTRICTS.find(x => x.id === state.place);
    if( !d ){
      $("placeNote").textContent = "生まれやすさは地区の人口で決まります。" +
        "◎○△✕ は医療・治安・ホロウからの近さで見た暮らしの見込みです。";
      return;
    }
    const o = outlook(d);
    $("placeNote").textContent = `${d.desc}。医療 ${level(d.med)} · ` +
      `教育 ${level(d.edu)} · 見込み ${o.mark} ${o.label}`;
  }
  $("placeSel").onchange = e => {
    state.place = e.target.value;
    renderPlaceNote();
  };
  segBind("eraSeg", v => {
    state.era = v;
    applyEra(v === "old");
    renderPlaces();
  });
  renderPlaces();
  segBind("paceSeg", v => (state.pace = +v));
  /*
  ** ネタバレの切り替えを置く localStorage のキー。この端末だけで覚えて
  ** おく（読めなくても「なし」で動く）。
  */
  const SPOILER_KEY = "eridu-life-spoiler";

  /* ネタバレの表示を on にするか切り、ボタンの見た目と保存を合わせる。 */
  function setSpoiler(on){
    window.Eridu.spoiler = on;
    $("spoilerSeg")
      .querySelectorAll("button")
      .forEach(b =>
        b.setAttribute("aria-pressed", (b.dataset.v === "on") === on)
      );
    try{
      localStorage.setItem(SPOILER_KEY, on ? "on" : "off");
    }catch(e){}
  }
  segBind("spoilerSeg", v => setSpoiler(v === "on"));
  try{
    setSpoiler(localStorage.getItem(SPOILER_KEY) === "on");
  }catch(e){
    setSpoiler(false);
  }
  segBind("speedSeg", v => {
    state.speed = +v;
    if( !paused && !pending ){
      schedule();
    }
  });
  $("pauseBtn").onclick = () => {
    paused = !paused;
    $("pauseBtn").textContent = paused ? "再開" : "一時停止";
    if( !paused ){
      schedule();
    }
  };

  /*
  ** 「生まれる」：自分と、名前の重ならない4人を生まれさせて、1年ずつ
  ** 進めはじめる。開発用の ?fall などがあれば、陥落の前年まで一気に進める。
  */
  $("bornBtn").onclick = () => {
    stopAlarm();
    /* 開発用：URL に ?fall を付けると旧都陥落の前に生まれ、1歳で陥落が来る */
    const era = DEBUG_FALL !== null ? "old" : state.era;
    /*
    ** 開発用の ?fall=near / far では範囲の中か外かを優先するので、
    ** 選んだ場所は使わない
    */
    const place =
      DEBUG_FALL === "near" || DEBUG_FALL === "far" ? "" : state.place;
    /*
    ** Eridu.meSource があれば（lab）、本人はそこからもらう（住民番号から
    ** 決まる人）。開発用の ?fall では使わない
    */
    const src = window.Eridu.meSource;
    me = src && DEBUG_FALL === null ? src(era, place) : null;
    if( !me ){
      me = newPerson(era, false, place);
    }
    if( DEBUG_FALL === "near" || DEBUG_FALL === "far" ){
      const want = DEBUG_FALL === "near" ? "inside" : "outside";
      for(let i = 0; i < 200 && me.d.zone !== want; i++){
        me = newPerson(era, false);
      }
    }
    if( DEBUG_FALL !== null ){
      /*
      ** 陥落の前年まで一気に進める（途中の決断はランダムに選ぶ）。
      ** 途中で亡くなったら、その年齢まで生きる人が出るまで生まれ直す
      */
      const want =
        DEBUG_FALL === "near"
          ? "inside"
          : DEBUG_FALL === "far"
            ? "outside"
            : null;
      for(let i = 0; i < 300; i++){
        me.fallAge = DEBUG_AGE;
        if( QS.has("alone") ){
          me.flags.forceAlone = 1;
        }
        while( me.alive && me.age < DEBUG_AGE - 1 ){
          step(me);
          const d = decisionFor(me);
          if( d ){
            autoChoose(me, d);
          }
        }
        if( me.alive && (!want || me.d.zone === want) ){
          break;
        }
        me = newPerson(era, false, place);
      }
    }
    /*
    ** 同じ1秒に生まれた人どうしで名前が重ならないようにする。
    ** Eridu.peerSource があれば（lab）、先にそこから人をもらい
    ** （ほかのプレイヤーの一生。本人の陥落の年齢を揃えることもある）、
    ** 足りない分をこの場で生む。
    */
    peers = window.Eridu.peerSource ? window.Eridu.peerSource(me) : [];
    while( peers.length < 4 ){
      const q = newPerson(era, true);
      if( q.name !== me.name && !peers.some(x => x.name === q.name) ){
        peers.push(q);
      }
    }
    /* 同じ1秒に生まれたので、陥落を迎える年齢も同じ */
    for(const q of peers){
      q.fallAge = me.fallAge;
      /* 開発用に本人を先に進めた場合は、4人も同じ年齢まで進める */
      while( q.alive && q.age < me.age ){
        stepPeer(q);
      }
    }
    ended = false;
    paused = false;
    pending = null;
    $("pauseBtn").disabled = false;
    $("pauseBtn").textContent = "一時停止";
    $("decision").innerHTML = "";
    /*
    ** 生まれたときの記録は 0歳の先頭に入れる
    ** （開発用に年齢を進めた場合も 0歳になるように）
    */
    const thiren = me.thiren ? me.kind + "のシリオンの" : "";
    const born = [
      {
        age: 0,
        text: `${me.birthD.name}で、${thiren}${me.sex}として生まれた。`,
        cls: "big",
      },
    ];
    /*
    ** 仮設住宅は必ず避難民の家庭。いまの時代のほかの街でも、旧都の
    ** 生き残りは新都の側か郊外に移り住んだので一部はそう。運命を持つ人
    ** （lab）は、同じ人ならいつも同じになるよう運命から決める
    */
    const u = me.fate
      ? window.Eridu.fateRng(me.fate + "|parents")()
      : Math.random();
    if( me.birthD.id === "camp" || (me.era !== "old" && u < 0.2) ){
      born.push({
        age: 0,
        text: "両親は旧都から逃れてきた人たちだった。",
        cls: "",
      });
    }
    me.log.unshift(...born);
    $("start").hidden = true;
    $("end").hidden = true;
    $("game").hidden = false;
    renderAll();
    schedule();
    window.scrollTo(0, 0);
  };
  renderMemorial();
})();
