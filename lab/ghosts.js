/*
** lab：同じ1秒に生まれた4人を、ほかのプレイヤーが遊び終えた一生にする。
** db.js を先に、ui.js より前に読み込むこと（Eridu.peerSource を置く）。
**
** 今のシーズン・同じ時代で、最期まで遊ばれた本人の一生（role = 'me'）
** から選ぶ。ほかのプレイヤーの一生を先に、足りなければこの端末の前の
** 一生（あなたの前世）を使う。それでも足りない分は ui.js がいつもどおり
** その場で生む。選んだ一生は記録（years・picks）を1年ずつたどるだけで、
** 乱数も決断も使わない。
*/
(() => {
  const E = window.Eridu;

  /* 地区の id から地区を返す。 */
  const district = id => E.DISTRICTS.find(x => x.id === id);

  /*
  ** sql.js で sql を値の配列 vals で問い合わせ、行を {欄: 値} の配列に
  ** して返す。
  */
  function rows(sql, vals){
    const r = E.db.exec(sql, vals);
    if( !r.length ){
      return [];
    }
    const cols = r[0].columns;
    return r[0].values.map(v => {
      const o = {};
      cols.forEach((c, i) => {
        o[c] = v[i];
      });
      return o;
    });
  }

  /*
  ** people の行 r から、同じ1秒の人として並べるオブジェクトを作って返す。
  ** ui.js が使う欄（名前・地区・年齢・生死・仕事・陥落の選択と安否など）を
  ** 持ち、replay(q) で1年進む。replay は years の行で住所と仕事を変え、
  ** 陥落の年齢で選択と安否を出し、亡くなった年齢で死因を出す。
  */
  function ghost(r, mine){
    const years = new Map();
    for(const y of rows("SELECT age, d, job FROM years WHERE person = ?", [
      r.id,
    ])){
      years.set(y.age, y);
    }
    const fall = rows(
      "SELECT o.label FROM picks k JOIN options o ON o.id = k.opt " +
        "WHERE k.person = ? AND k.key LIKE 'fall%'",
      [r.id]
    );
    const birth = district(r.birth_d);
    return {
      name: r.name,
      sex: r.sex,
      thiren: !!r.thiren,
      kind: r.kind,
      era: r.era,
      birthD: birth,
      d: birth,
      age: 0,
      alive: true,
      cause: null,
      job: "none",
      flags: {},
      fallAge: r.fall_age,
      isPeer: true,
      tag: mine ? "あなたの前世" : "ほかのプレイヤー",
      ghostOf: r.id,
      /* 1年進める（上の見出しのとおり） */
      replay(q){
        q.age++;
        const y = years.get(q.age);
        if( y ){
          q.d = district(y.d);
          q.job = y.job;
        }
        if( q.fallAge !== null && q.age === q.fallAge ){
          q.flags.fall = 1;
          q.fallChoice = fall.length ? fall[0].label : "";
          q.fallSurvived = !!r.fall_survived;
          if( r.family_lost ){
            q.flags.familyLost = 1;
          }
        }
        if( q.age >= r.age ){
          q.alive = false;
          q.cause = r.cause;
        }
      },
    };
  }

  /*
  ** 本人 me と同じ1秒に生まれる人を、遊び終えた一生から4人まで選んで
  ** 返す。旧都陥落の前の時代では、陥落の年齢が本人と同じ一生だけを使う
  ** （同じ1秒に生まれた人は同じ年齢で陥落に遭うため）。選んだ一生は
  ** cohort に残す。
  */
  E.peerSource = me => {
    if( !E.db ){
      return [];
    }
    const info = E.dbInfo();
    const cand = rows(
      "SELECT p.*, g.player FROM people p JOIN games g ON g.id = p.game " +
        "WHERE p.role = 'me' AND p.alive = 0 AND p.season = ? " +
        "AND p.era = ? AND p.id != ? " +
        "ORDER BY (g.player = ?), random() LIMIT 200",
      [info.season, me.era, E.personId(me) || 0, info.player]
    );
    /*
    ** 本人の陥落の年齢は前の一生に合わせない（合わせると、うつり合って
    ** シーズンの陥落の年齢が一つに固まる）。同じ年齢の一生だけを並べる
    */
    const pool =
      me.era === "old" ? cand.filter(r => r.fall_age === me.fallAge) : cand;
    const out = [];
    for(const r of pool){
      if( out.length >= 4 ){
        break;
      }
      if( r.name === me.name || out.some(q => q.name === r.name) ){
        continue;
      }
      out.push(ghost(r, r.player === info.player));
    }
    for(const q of out){
      try{
        E.db.run("INSERT OR IGNORE INTO cohort VALUES(?, ?)", [
          info.game, q.ghostOf,
        ]);
      }catch(e){
        E.dbErrors.push(e.message + " / cohort");
      }
    }
    return out;
  };
})();
