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
  ** 本人を作って返す（ui.js の「生まれる」から）。時代 era、生まれる
  ** 場所 place（"" ならどこでも）。番号は上の見出しのとおりに決め、
  ** 歩きかけの記録を作る（E.walk。表に書くのは亡くなったとき）。
  ** データベースの用意ができていなければ null（ui.js がいつもどおり生む）。
  */
  E.meSource = (era, place) => {
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
  };

  /*
  ** 本人 me と同じ組（同じ1秒）の4人を作って返す。誰かが歩いた番号なら
  ** その道を p.route に入れる。me に運命がなければ（開発用）空の配列。
  */
  E.peerSource = me => {
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
