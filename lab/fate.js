/*
** lab：本人と同じ1秒の4人を、住民番号から作る。
** db.js を先に、ui.js より前に読み込むこと（Eridu.meSource と
** Eridu.peerSource を置く）。
**
** 世界は先に決まっている。シーズン・版・時代・住民番号から、その人の
** 生まれと運命が決まる（sim.js の fate）。住民番号は5つずつの組に
** 分かれ、同じ組の5人が「同じ1秒に生まれた人たち」で、陥落に遭う年齢も
** 組で同じ。
**
** 本人の番号：ふだんは、まだ誰も歩いていない番号のいちばん小さいもの
** （生まれる場所を選んだら、そこに生まれる番号）。REBORN の割合で、
** もう誰かが歩いた番号に生まれる（同じ人を、もう一度生きる）。
** 歩いていない番号がなくなったら、次のシーズンを始める（ワイプ）。
** 版（E.VERSION）が変わったときも次のシーズンを始める（同じ道でも
** 結果が変わるため）。前のシーズンの行は消さない。
**
** 同じ組の4人：誰かがその番号を歩き終えていれば、いちばん早く
** 歩き終えた人の道をたどる。誰も歩いていなければ、運命が選ぶ道を行く。
** どちらも見た目では区別しない。歩きかけの番号は「歩かれていない」
** 扱い（道は最後の選択まで決まらない）。
**
** サーバー：Worker（worker/、docs/worker.md）から配られているときは、
** 番号と同じ1秒の道をサーバーの API からもらい、亡くなったら道を送る
** （みんなで1つの世界）。✦ の印はサーバーの答えで決める。サーバーに
** つながらないとき、GitHub Pages や file:// で開いたとき、?local を
** 付けたときは、今までどおりこの端末の表だけで決める。
*/
(() => {
  const E = window.Eridu;

  /* 住民番号の範囲の既定（6桁）。開発用に ?ids=N で1シーズンを N 人にできる */
  const NO_MIN = 100000;
  const NO_MAX = 999999;
  const IDS = +new URLSearchParams(location.search).get("ids") || 0;
  /* もう誰かが歩いた番号に生まれる割合。開発用に ?reborn=1 などで変えられる */
  const RB = new URLSearchParams(location.search).get("reborn");
  const REBORN = RB === null ? 0.2 : +RB;
  /* 同じ1秒に生まれる人数（本人を含む） */
  const BLOCK = 5;

  /* 今のシーズンと時代（本人が生まれたときに決まる）。peerSource が使う */
  let now = null;

  /* 今の時刻を ISO の文字列で返す。 */
  const iso = () => new Date().toISOString();

  /*
  ** 次のシーズンを始めて、その行を返す。prev（今のシーズンの行）が
  ** あれば終わった時刻を書く。行は消さない。
  */
  function newSeason(prev){
    if( prev ){
      E.dbRun("UPDATE seasons SET ended_at = ? WHERE id = ?", [iso(), prev.id]);
    }
    E.dbRun(
      "INSERT INTO seasons(version, no_min, no_max, started_at) " +
        "VALUES(?, ?, ?, ?)",
      [E.VERSION, NO_MIN, NO_MAX, iso()]
    );
    return E.dbRows("SELECT * FROM seasons ORDER BY id DESC LIMIT 1")[0];
  }

  /* 今のシーズンの行を返す。ない、または版が今と違えば、次を始める。 */
  function season(){
    const s = E.dbRows("SELECT * FROM seasons ORDER BY id DESC LIMIT 1")[0];
    return s && s.version === E.VERSION ? s : newSeason(s);
  }

  /* シーズン s で配れるいちばん大きい番号を返す（?ids=N を見る）。 */
  const top = s => (IDS ? Math.min(s.no_max, s.no_min + IDS - 1) : s.no_max);

  /* シーズン s・時代 era・番号 no の人の運命の名前（sim.js の fate）を返す。 */
  const fateKey = (s, era, no) => `s${s.id}|v${s.version}|${era}|${no}`;

  /* 番号 no が入る組の、最初の番号を返す。 */
  const blockStart = (s, no) =>
    s.no_min + Math.floor((no - s.no_min) / BLOCK) * BLOCK;

  /*
  ** シーズン s・時代 era・番号 no の人を作って返す。isPeer は同じ1秒の
  ** 4人のとき true。陥落の前の時代なら、陥落に遭う年齢を組から決める。
  */
  function resident(s, era, no, isPeer){
    const p = E.newPerson(era, isPeer, null, fateKey(s, era, no));
    p.no = no;
    if( era === "old" ){
      const key = fateKey(s, era, "block" + blockStart(s, no));
      p.fallAge = E.fallAgeFrom(E.fateRng(key)());
    }
    return p;
  }

  /* シーズン s・時代 era で、もう歩かれた番号の集まり（Set）を返す。 */
  function walked(s, era){
    const r = E.dbRows(
      "SELECT DISTINCT no FROM people WHERE season = ? AND era = ?",
      [s.id, era]
    );
    return new Set(r.map(x => x.no));
  }

  /* 番号 no の人が地区 place に生まれるかを返す（place が "" なら true）。 */
  const fits = (s, era, no, place) =>
    !place || resident(s, era, no, true).birthD.id === place;

  /*
  ** まだ歩かれていない番号のうち、いちばん小さいものを返す。place が
  ** あれば、そこに生まれる番号を先に探す（3000番先まで。なければ
  ** 場所は見ない）。歩かれていない番号がなければ 0。
  */
  function firstFree(s, era, done, place){
    let first = 0;
    for(let n = s.no_min; n <= top(s); n++){
      if( done.has(n) ){
        continue;
      }
      if( !first ){
        first = n;
      }
      if( fits(s, era, n, place) ){
        return n;
      }
      if( n - first > 3000 ){
        break;
      }
    }
    return first;
  }

  /*
  ** この端末の表だけで本人を作って返す（E.meSource から）。時代 era、
  ** 生まれる場所 place（"" ならどこでも）。番号は上の見出しのとおりに決め、
  ** 歩きかけの記録を作る（E.walk。表に書くのは亡くなったとき）。
  ** データベースの用意ができていなければ null（ui.js がいつもどおり生む）。
  */
  function localMe(era, place){
    if( !E.db ){
      return null;
    }
    let s = season();
    const done = walked(s, era);
    let no = 0;
    if( done.size && Math.random() < REBORN ){
      const list = [...done].filter(n => fits(s, era, n, place));
      if( list.length ){
        no = list[Math.floor(Math.random() * list.length)];
      }
    }
    if( !no ){
      no = firstFree(s, era, done, place);
    }
    if( !no ){
      s = newSeason(s);
      no = firstFree(s, era, new Set(), place);
    }
    const p = resident(s, era, no, false);
    E.walk(p, s.id, era, no);
    now = {s, era};
    return p;
  }

  /*
  ** この端末の表だけで、本人 me と同じ組（同じ1秒）の4人を作って返す
  ** （E.peerSource から）。誰かが歩いた番号なら
  ** その道を p.route に入れる。me に運命がなければ（開発用）空の配列。
  */
  function localPeers(me){
    if( !me.fate || !now ){
      return [];
    }
    const {s, era} = now;
    const start = blockStart(s, me.no);
    const out = [];
    for(let n = start; n < start + BLOCK && n <= top(s); n++){
      if( n === me.no ){
        continue;
      }
      const q = resident(s, era, n, true);
      const r = E.dbRows(
        "SELECT path FROM people WHERE season = ? AND era = ? AND no = ? " +
          "AND path != '' ORDER BY game LIMIT 1",
        [s.id, era, n]
      );
      if( r.length ){
        q.route = r[0].path.split(",");
        q.routeAt = 0;
      }
      out.push(q);
    }
    return out;
  }

  /*
  ** サーバーにつなぐか。http(s) で開いていて、GitHub Pages ではなく、
  ** ?local がないとき。つながらなかったら false にして端末だけで続ける
  */
  let server = /^https?:$/.test(location.protocol) &&
    !location.hostname.endsWith("github.io") &&
    !new URLSearchParams(location.search).has("local");
  /* サーバーが配った本人の、一回の番号（games.id）を引く表 */
  const games = new WeakMap();
  /* 前世の記録の localStorage のキー（ui.js と同じ） */
  const MEM_KEY = "eridu-life-memorial";

  /*
  ** API の path に、本文 obj があれば POST で、なければ GET で送り、
  ** 答えの JSON を返す。つながらない・200 でないときは例外を投げる。
  */
  async function api(path, obj){
    const opt = obj === undefined
      ? {}
      : {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(obj),
      };
    const r = await fetch("/api/" + path, opt);
    if( !r.ok ){
      throw new Error(path + " " + r.status);
    }
    return r.json();
  }

  /*
  ** サーバーから番号をもらって本人を作り、返す（時代 era、生まれる場所
  ** place）。シーズンはサーバーのもの。この端末の表にも同じシーズンの
  ** 行を置き、歩きかけの記録を作る（E.walk）。
  */
  async function serverMe(era, place){
    await E.dbReady;
    const b = await api("born", {
      player: E.player, era, place, version: E.VERSION,
    });
    const s = {
      id: b.season, version: b.version, no_min: NO_MIN, no_max: NO_MAX,
    };
    E.dbRun(
      "INSERT OR IGNORE INTO seasons(id, version, no_min, no_max, " +
        "started_at) VALUES(?, ?, ?, ?, ?)",
      [s.id, s.version, s.no_min, s.no_max, iso()]
    );
    const p = resident(s, era, b.no, false);
    E.walk(p, s.id, era, b.no);
    now = {s, era};
    games.set(p, b.game);
    return p;
  }

  /*
  ** サーバーが配った本人 me と同じ1秒の4人を作って返す。歩かれた番号
  ** なら、サーバーが返した道を p.route に入れる。
  */
  async function serverPeers(me){
    const {s, era} = now;
    const r = await api(`peers?game=${games.get(me)}&player=${E.player}`);
    return r.peers.map(x => {
      const q = resident(s, era, x.no, true);
      if( x.path ){
        q.route = x.path;
        q.routeAt = 0;
      }
      return q;
    });
  }

  /*
  ** 亡くなった本人 p の印 ✦ を、mark のとおりに画面と前世の記録へ
  ** 出し直す（サーバーの答えが最期の画面より後に届いたとき）。
  */
  function showMark(p, mark){
    const span = `<span class="mark" aria-hidden="true">✦</span>`;
    const head = document.querySelector("#end:not([hidden]) .eyebrow");
    if( head && head.textContent.includes("No." + p.no) ){
      const old = head.querySelector(".mark");
      if( old && !mark ){
        old.remove();
      }else if( !old && mark ){
        head.insertAdjacentHTML("beforeend", span);
      }
    }
    try{
      const m = JSON.parse(localStorage.getItem(MEM_KEY) || "[]");
      if( m.length && m[0].no === p.no && m[0].n === p.name ){
        m[0].m = mark;
        localStorage.setItem(MEM_KEY, JSON.stringify(m));
        const who = document.querySelector("#memorial > div > span");
        const old = who && who.querySelector(".mark");
        if( old && !mark ){
          old.remove();
        }else if( who && !old && mark ){
          who.insertAdjacentHTML("beforeend", span);
        }
      }
    }catch(e){}
  }

  /*
  ** 亡くなった本人 p の道 path（選択肢の ID の配列）をサーバーに送る
  ** （db.js の commit から）。サーバーが配った本人でなければ何もしない。
  ** 印は、端末の表ではなくサーバーの答えで決める。届くまでは付けない。
  */
  E.onCommit = (p, path) => {
    const game = games.get(p);
    if( !game ){
      return;
    }
    games.delete(p);
    p.mark = false;
    api("died", {player: E.player, game, path}).then(
      r => {
        p.mark = r.mark;
        showMark(p, r.mark);
      },
      e => console.warn("lab: 道を送れませんでした", e)
    );
  };

  /*
  ** 本人を作って返す（ui.js の「生まれる」から）。サーバーにつなぐなら
  ** サーバーから、つながらなければ端末の表から（localMe）。
  */
  E.meSource = async (era, place) => {
    if( server ){
      try{
        return await serverMe(era, place);
      }catch(e){
        console.warn("lab: サーバーにつながらないので端末だけで遊びます", e);
        server = false;
      }
    }
    return localMe(era, place);
  };

  /*
  ** 本人 me と同じ1秒の4人を作って返す。サーバーが配った本人なら
  ** サーバーから、そうでなければ端末の表から（localPeers）。サーバーから
  ** もらえなければ、運命が選ぶ道を行く4人にする。
  */
  E.peerSource = async me => {
    if( games.has(me) ){
      try{
        return await serverPeers(me);
      }catch(e){
        console.warn("lab: 同じ1秒の道をもらえませんでした", e);
        const {s, era} = now;
        const start = blockStart(s, me.no);
        const out = [];
        for(let n = start; n < start + BLOCK; n++){
          if( n !== me.no ){
            out.push(resident(s, era, n, true));
          }
        }
        return out;
      }
    }
    return localPeers(me);
  };

  /*
  ** データベースの用意ができるまでは「生まれる」を押せないようにする
  ** （用意の前に生まれると、番号から決まる人にならないため）。読み込めな
  ** かったときは押せるように戻す（いつもどおりその場で生まれる）。
  */
  const born = document.getElementById("bornBtn");
  born.disabled = true;
  E.dbReady.then(
    () => {
      born.disabled = false;
    },
    () => {
      born.disabled = false;
    }
  );

  /*
  ** 今のシーズンの番号と、時代ごとの歩かれていない番号の数を返す
  ** （lab の画面の表示用）。
  */
  E.labInfo = () => {
    const s = season();
    const size = top(s) - s.no_min + 1;
    return {
      season: s.id,
      left: {
        now: size - walked(s, "now").size,
        old: size - walked(s, "old").size,
      },
    };
  };
})();
