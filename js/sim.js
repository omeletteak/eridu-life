/*
** シミュレーション：人の生成・決断・出来事・1年の進行。
** DOM には触らないので Node でも動く。data.js を先に読み込むこと。
*/
(function(E){
  const {DISTRICTS, GIVEN, FAMILY, THIREN_KIND, JOBS} = E;

  /*
  ** 乱数。0 以上 1 未満を返す関数。sim.js の中では必ずこれを使う。
  ** 一括シミュレーションでは setRandom でシード付きのものに差し替える。
  */
  let R = Math.random;

  /*
  ** ネタバレの切り替え。標準（false）では組織の名前を出さず役割だけにする。
  ** スタート画面の「ネタバレあり」で true になる。
  ** 陥落の日に組織が具体的に何をしたかは描かない（名前の切り替えだけ）。
  */
  E.spoiler = false;

  /*
  ** 陥落の日に出てくる組織の呼び名を返す。army は範囲の中で避難路を
  ** 確保する部隊、yama は衛非地区で避難民を受け入れる人たち。
  */
  const who = () =>
    E.spoiler
      ? {army: "防衛軍の部隊", yama: "雲嶽山の人たち"}
      : {army: "制服の部隊", yama: "山の道場の人たち"};

  /* 範囲の中の陥落の文に足す一文（避難路を確保する部隊）を返す。 */
  const armyLine = () => who().army + "が、避難路を確保しようとしています。";

  /*
  ** 範囲の外の陥落の文に足す一文を返す。p が衛非地区（澄輝坪・泅瓏囲）に
  ** いれば山の道場の人たちの一文、そうでなければ空文字。
  */
  const yamaLine = p =>
    ["waifei", "qiulong"].includes(p.d.id)
      ? who().yama + "が、避難してきた人を受け入れています。"
      : "";

  /* 乱数を fn に差し替える。fn は 0 以上 1 未満を返す関数。 */
  E.setRandom = fn => {
    R = fn;
  };

  /* 今の乱数を一つ返す。ui.js など sim.js の外から使う。 */
  const rnd = () => R();

  /* v を a 以上 b 以下に収めて返す。状態値は既定の 0〜100。 */
  const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

  /* 配列 a から一つを等しい確率で選んで返す。 */
  const pick = a => a[Math.floor(R() * a.length)];

  /*
  ** 配列 arr から一つを選んで返す。選ばれやすさは w(要素) に比例する。
  ** w の合計が 0 のときは最後の要素を返す。
  */
  const wpick = (arr, w) => {
    let s = arr.reduce((t, x) => t + w(x), 0),
      r = R() * s;
    for(const x of arr){
      r -= w(x);
      if( r <= 0 ){
        return x;
      }
    }
    return arr[arr.length - 1];
  };

  /* 標準正規分布（平均0・標準偏差1）に従う乱数を返す（ボックス＝ミュラー法） */
  const gauss = () => {
    let u = 0,
      v = 0;
    while( !u ){
      u = R();
    }
    while( !v ){
      v = R();
    }
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /*
  ** 今の住所（p.d）の医療の手厚さから、死亡率とけがの重さにかける倍率を
  ** 返す。医療が手厚いほど小さい（ルミナスクエア 0.76 · 郊外 1.21）。
  */
  const careF = p => 1.3 - 0.6 * p.d.med;

  /* p にけがや病気で健康を n 減らす。重さは医療しだい（careF）。 */
  const hurt = (p, n) => {
    p.hp = clamp(p.hp - n * careF(p));
  };

  /* 医療・教育の水準 v（0〜1）を、住民票に出す言葉にして返す。 */
  const level = v =>
    v >= 0.75
      ? "充実"
      : v >= 0.5
        ? "ふつう"
        : v >= 0.3
          ? "乏しい"
          : "ほとんどない";

  /* お金 n（万ディニー）を「1,234万ディニー」の形の文字列にして返す。 */
  const fmt = n =>
    (n < 0 ? "−" : "") +
    Math.abs(Math.round(n)).toLocaleString("ja-JP") +
    "万ディニー";

  /*
  ** 新しく生まれた人を作って返す。era は "now"（いまの時代）か "old"
  ** （旧都陥落の前）。地区・名前・人間かシリオンか・隠しパラメータの
  ** エーテル適性（apt）を抽選する。
  **
  ** placeId を渡すとその地区に生まれる（スタート画面で選んだとき）。
  ** なければ、または その時代に生まれられない地区なら、時代ごとの重みで
  ** 抽選する。isPeer=true の人は記録（log）を残さない（並走する4人と
  ** 一括シミュレーション用）。陥落の前に生まれた人は、陥落に遭う年齢
  ** fallAge（1〜60歳、若いほど出やすい）も決める。
  */
  function newPerson(era, isPeer, placeId){
    const d =
      (placeId &&
        DISTRICTS.find(
          x => x.id === placeId && (era === "old" ? x.old : x.w) > 0
        )) ||
      wpick(
        DISTRICTS.filter(x => (era === "old" ? x.old : x.w) > 0),
        x => (era === "old" ? x.old : x.w)
      );
    const thiren = R() < 0.2;
    const p = {
      name: pick(FAMILY) + " " + pick(GIVEN),
      sex: R() < 0.5 ? "女の子" : "男の子",
      thiren,
      kind: thiren ? pick(THIREN_KIND) : null,
      d,
      birthD: d,
      era,
      age: 0,
      alive: true,
      cause: null,
      hp: clamp(70 + gauss() * 10),
      hap: 55,
      know: clamp(20 + d.edu * 30),
      rel: 60,
      eth: 0,
      money: Math.round(d.wealth * 300),
      apt: clamp(50 + gauss() * 20, 0, 100),
      job: "none",
      proxy: false,
      married: false,
      kids: 0,
      flags: {},
      years: [],
      fallAge: era === "old" ? 1 + Math.floor(60 * Math.pow(R(), 1.3)) : null,
      isPeer,
      no: Math.floor(R() * 9e5) + 1e5,
    };
    p.log = [];
    return p;
  }

  /*
  ** p の人生の記録に、今の年齢で text を足す。cls は表示の種類
  ** （good / bad / eth / big を空白区切りで）。isPeer の人には何もしない。
  */
  function say(p, text, cls = ""){
    if( p.isPeer ){
      return;
    }
    p.log.push({age: p.age, text, cls});
  }

  /* ===== 決断 ===== */

  /*
  ** この年に p が迎える決断を返す。なければ null。
  ** 決断は D のどれかが作るオブジェクトで、
  **
  **   title  見出し（年齢などが入るので、見分けには key を使う）
  **   key    決断の種類（"school" や "fall" など。D の名前と同じ）
  **   text   状況の説明
  **   opts   選択肢の配列。各要素は
  **            id     選択肢の ID（"key.名前"）。ラベルが状況で変わっても同じ
  **            t      選択肢の型（KINDS のキー）。時代をまたいで比べるのに使う
  **            label  選択肢 / sub 補足
  **            fx     選んだときに p を変える関数
  **   alarm  旧都陥落のときだけ。範囲の中は "near"、外は "far"
  **
  ** 同じ決断は一生に一度だけ出す（p.flags に印をつける）。優先順は
  ** 旧都陥落 → ホロウ災害 → 侵蝕の症状 → 節目（15/18/24/29/42/62歳）。
  */
  function decisionFor(p){
    if( !p.alive ){
      return null;
    }
    const f = p.flags;
    /*
    ** 旧都陥落：飲まれる範囲の中にいれば避難の決断、外にいれば避難民を
    ** 迎える決断。一部の人は、陥落が起きた時点で自分以外の家族がすでに
    ** 消息不明になっている。
    */
    if( p.fallAge !== null && p.age === p.fallAge && !f.fall ){
      f.fall = 1;
      if( f.forceAlone || R() < FAMILY_LOST_RATE ){
        loseFamily(p);
      }
      return p.d.zone === "inside" ? D.fall(p) : D.fallFar(p);
    }
    if( f.disaster && !f.disDone ){
      f.disDone = 1;
      return D.disaster(p);
    }
    if( p.eth >= 60 && !f.ethDec ){
      f.ethDec = 1;
      return D.ether(p);
    }
    /* 節目の決断は、陥落や災害と同じ年に重なったら翌年以降に持ち越す */
    if( p.age >= 15 && !f.d15 ){
      f.d15 = 1;
      return D.school(p);
    }
    if( p.age >= 18 && !f.d18 ){
      f.d18 = 1;
      return D.work(p);
    }
    /*
    ** 治安局の局員には、裏稼業の誘いはめったに来ない
    ** （来なかった年は何も起きない）。
    */
    if( p.age >= 24 && !f.d24 ){
      f.d24 = 1;
      if( p.job !== "police" || R() < RARE ){
        return D.proxy(p);
      }
    }
    if( p.age >= 29 && !f.d29 ){
      f.d29 = 1;
      return D.family(p);
    }
    if( p.age >= 42 && !f.d42 ){
      f.d42 = 1;
      return D.turn(p);
    }
    if( p.age >= 62 && !f.d62 ){
      f.d62 = 1;
      return D.retire(p);
    }
    return null;
  }

  /*
  ** 選択肢の型。違う決断や違う時代の選択を比べるための分け方。
  ** name は文を作るときの呼び名、group は比べるときにまとめる単位
  ** （「助ける」と「探す」は、危険を取って人のもとへ行く点で同じ組）。
  **
  ** 型と選択肢の ID は、共有した記録との互換のため追記だけにする
  ** （名前を変えたり消したりしない）。
  */
  const KINDS = {
    /* 危機のとき */
    flee: {name: "逃げる", group: "flee"},
    help: {name: "助ける", group: "reach"},
    search: {name: "探す", group: "reach"},
    guard: {name: "守る", group: "guard"},
    share: {name: "分ける", group: "share"},
    wait: {name: "待つ", group: "wait"},
    shut: {name: "閉ざす", group: "shut"},
    entrust: {name: "委ねる", group: "entrust"}, /* 一択。比べない */
    /* 人生の節目 */
    stable: {name: "安定", group: "stable"},
    venture: {name: "挑む", group: "venture"},
    stray: {name: "外れる", group: "stray"},
    together: {name: "共に", group: "together"},
    alone: {name: "ひとり", group: "alone"},
    change: {name: "変える", group: "change"},
    keep: {name: "続ける", group: "keep"},
  };

  /*
  ** 決断を作る関数の表。どれも p を受け取り、その人の状況に合わせた決断
  ** （decisionFor の説明を参照）を返す。
  */
  const D = {
    /* 15歳の進路。教育の水準（p.d.edu）で受験勉強の伸びが変わる。 */
    school: p => ({
      title: p.age + "歳 · 進路",
      key: "school",
      text:
        "中学を終える年です。" +
        p.d.name +
        (p.d.edu >= 0.6
          ? "には進学先がいくつもあります。"
          : "から通える進学先は多くありません。"),
      opts: [
        {
          id: "school.study",
          t: "stable",
          label: "進学校を目指して勉強する",
          sub:
            p.d.edu >= 0.5
              ? "知識が伸びる。学費がかかる"
              : "近くに塾がない。伸びは小さい",
          fx: p => {
            p.flags.study = 1;
            p.job = "student";
            p.know = clamp(p.know + Math.round(6 + p.d.edu * 10));
            p.money -= 40;
            say(
              p,
              p.d.edu >= 0.5
                ? "受験勉強に打ち込んだ。"
                : "参考書を取り寄せて、ひとりで受験勉強をした。"
            );
          },
        },
        {
          id: "school.parttime",
          t: "together",
          label: "学校に通いながらバイトで稼ぐ",
          sub: "お金と人間関係",
          fx: p => {
            p.job = "student";
            p.money += 60;
            p.rel = clamp(p.rel + 5);
            p.know = clamp(p.know + 4);
            say(p, "放課後はラーメン屋の厨房に立った。");
          },
        },
        {
          id: "school.wild",
          t: "stray",
          label: "走り屋の仲間とつるむ",
          sub: "人間関係と幸福。危うい道",
          fx: p => {
            p.flags.wild = 1;
            p.job = "student";
            p.rel = clamp(p.rel + 10);
            p.hap = clamp(p.hap + 8);
            p.know = clamp(p.know - 4);
            say(p, "夜の郊外をバイクで走るようになった。");
          },
        },
      ],
    }),
    /*
    ** 18歳の仕事。大手の合格の見込みは知識・進学校・シリオンかどうかで
    ** 決まる。走り屋とつるんだ人にはギャングの道も出る。
    */
    work: p => {
      const corpChance = clamp(
        (p.know - 35) * 1.6 + (p.flags.study ? 20 : 0) - (p.thiren ? 15 : 0),
        3,
        90
      );
      return {
        title: p.age + "歳 · 仕事",
        key: "work",
        text:
          "社会に出る年です。" +
          (p.thiren ? "シリオンへの採用の壁は、まだ残っています。" : "") +
          "エーテル適性の検査結果は「" +
          aptLabel(p.apt) +
          "」でした。",
        opts: [
          {
            id: "work.corp",
            t: "venture",
            label: "大手のホロウ調査企業を受ける",
            sub: "合格の見込み 約" + Math.round(corpChance) + "%",
            fx: p => {
              if( R() * 100 < corpChance ){
                p.job = "corp";
                say(p, "ホロウ調査企業に採用された。", "good big");
              }else{
                p.job = "shop";
                p.hap = clamp(p.hap - 8);
                say(p, "選考に落ちた。商店街で働きはじめる。", "bad");
              }
            },
          },
          {
            id: "work.build",
            t: "stable",
            label: "建設・解体の現場で働く",
            sub: "そこそこの収入。少しずつ侵蝕",
            fx: p => {
              p.job = "build";
              say(
                p,
                p.fallAge !== null && !p.flags.fall
                  ? "建設現場で働きはじめた。"
                  : "再開発の現場で働きはじめた。"
              );
            },
          },
          {
            id: "work.police",
            t: "help",
            label: "治安局に志願する",
            sub: p.hp >= 55 ? "体力は足りている" : "体力に不安",
            fx: p => {
              if( p.hp >= 55 || R() < 0.4 ){
                p.job = "police";
                say(p, "治安局の局員になった。", "big");
              }else{
                p.job = "build";
                say(p, "体力検査で落ち、現場仕事に就いた。", "bad");
              }
            },
          },
          {
            id: "work.raider",
            t: "venture",
            label: "無許可でホロウに潜る",
            sub: "高収入。侵蝕と死の危険",
            fx: p => {
              p.job = "raider";
              say(p, "無許可のホロウレイダーになった。", "eth big");
            },
          },
          ...(p.flags.wild
            ? [
                {
                  id: "work.gang",
                  t: "stray",
                  label: "ギャングの仲間と生きる",
                  sub: "居場所はある。危険も多い",
                  fx: p => {
                    p.job = "gang";
                    say(
                      p,
                      "ギャングの仲間と、郊外の荒野を走り回るようになった。",
                      "big"
                    );
                  },
                },
              ]
            : []),
        ],
      };
    },
    /* 24歳の裏稼業（ホロウ内の道案内）の誘い。 */
    proxy: p => ({
      title: p.age + "歳 · 誘い",
      key: "proxy",
      text: "顔見知りから、ホロウ内の道案内をする裏稼業の手伝いを頼まれました。報酬は悪くありません。",
      opts: [
        {
          id: "proxy.decline",
          t: "stable",
          label: "断る",
          sub: "何も変わらない",
          fx: p => say(p, "誘いを断った。"),
        },
        {
          id: "proxy.accept",
          t: "venture",
          label: "引き受ける",
          sub: "副収入。侵蝕と治安局の目",
          fx: p => {
            p.proxy = true;
            say(p, "裏でホロウの案内を請け負うようになった。", "eth big");
          },
        },
      ],
    }),
    /* 29歳の家族。一緒に暮らせる見込みは人間関係しだい。 */
    family: p => {
      /*
      ** 陥落で家族が消息不明になって3年以内は、気持ちの整理がつかず、
      ** 長く付き合ってきた相手がいることはめったにない。
      */
      const grieving =
        p.flags.familyLost && p.age - p.fallAge <= 3 && R() >= RARE;
      const text = grieving
        ? "家族の行方がわからないまま、気になる人とも距離を置いています。"
        : p.rel >= 55
          ? "長く付き合ってきた相手がいます。"
          : "気になる人はいますが、まだ距離があります。";
      const bonus = grieving ? -5 : 20;
      return {
        title: p.age + "歳 · 家族",
        key: "family",
        text,
        opts: [
          {
            id: "family.together",
            t: "together",
            label: "一緒に暮らす",
            sub: grieving
              ? "今は難しいかもしれない"
              : "成功の見込みは人間関係しだい",
            fx: p => {
              if( R() * 100 < p.rel + bonus ){
                p.married = true;
                p.rel = clamp(p.rel + 10);
                p.hap = clamp(p.hap + 10);
                say(p, "結婚した。", "good big");
                if( R() < 0.65 ){
                  p.kids = 1 + (R() < 0.4 ? 1 : 0);
                  say(p, "子どもが生まれた。", "good");
                }
              }else{
                p.hap = clamp(p.hap - 10);
                say(p, "関係は終わった。", "bad");
              }
            },
          },
          {
            id: "family.alone",
            t: "alone",
            label: "ひとりで、ボンプと暮らす",
            sub: "気楽。老後は少し寂しい",
            fx: p => {
              p.hap = clamp(p.hap + 3);
              p.flags.bangboo = 1;
              say(p, "中古のボンプを買って、二人暮らしになった。");
            },
          },
        ],
      };
    },
    /* 42歳の転機。店を開く・続ける・安全な地区へ引っ越す。 */
    turn: p => {
      /*
      ** 陥落前はまだルミナスクエアがない。引っ越し先は旧都の中心街
      ** （範囲の中に入るので、陥落を中で迎えることになる）。
      */
      const preFall = p.fallAge !== null && !p.flags.fall;
      const to = DISTRICTS.find(x => x.id === (preFall ? "kcenter" : "center"));
      return {
        title: p.age + "歳 · 転機",
        key: "turn",
        text:
          "仕事は「" +
          JOBS[p.job].name +
          "」。貯えは" +
          fmt(p.money) +
          "です。",
        opts: [
          {
            id: "turn.shop",
            t: "venture",
            label: p.flags.lostShop
              ? "もう一度、自分の店を開く"
              : "自分の店を開く",
            sub: p.money >= 300 ? "資金はある" : "資金不足。借金になる",
            fx: p => {
              p.money -= 300;
              p.job = "owner";
              p.proxy = false;
              say(
                p,
                p.d.name +
                  "の路地に" +
                  (p.flags.lostShop ? "もう一度、" : "") +
                  "小さな店を開いた。",
                "big"
              );
            },
          },
          {
            id: "turn.keep",
            t: "keep",
            label: "今の仕事を続ける",
            sub: "変化なし",
            fx: p => say(p, "同じ毎日を続けることにした。"),
          },
          ...(p.d.id !== to.id
            ? [
                {
                  id: "turn.move",
                  t: "change",
                  label: to.name + "へ引っ越す",
                  sub: "安全になる。家賃が重い",
                  fx: p => {
                    p.money -= 200;
                    p.d = to;
                    p.rel = clamp(p.rel - 5);
                    say(p, to.name + "のマンションに移った。", "big");
                  },
                },
              ]
            : []),
        ],
      };
    },
    /* 62歳の老後。引退するか働き続けるか。 */
    retire: p => ({
      title: p.age + "歳 · 老後",
      key: "retire",
      text: "体の衰えを感じはじめています。",
      opts: [
        {
          id: "retire.retire",
          t: "stable",
          label: "引退する",
          sub: "穏やかに暮らす",
          fx: p => {
            p.job = "retired";
            p.proxy = false;
            say(p, "仕事を退いた。");
          },
        },
        {
          id: "retire.work",
          t: "keep",
          label: "働き続ける",
          sub: "お金は入る。体には負担",
          fx: p => {
            p.flags.oldwork = 1;
            say(p, "まだ働くことにした。");
          },
        },
      ],
    }),
    /*
    ** 侵蝕度が60を超えたときの症状。ホロウに関わる仕事（か裏稼業）なら
    ** 仕事を変える。そうでなければ侵蝕の元は住む地区なので引っ越す
    ** （すでにホロウから遠い地区なら外出を控える）。働いていない人は
    ** 「我慢して働く」ではなく「様子を見る」。
    */
    ether: p => {
      const hollowWork =
        ["raider", "police", "build", "corp", "gang"].includes(p.job) ||
        p.proxy;
      const working = !["none", "student", "retired"].includes(p.job);
      const preFall = p.fallAge !== null && !p.flags.fall;
      const safe = DISTRICTS.find(
        x => x.id === (preFall ? "kcenter" : "center")
      );
      return {
        title: "侵蝕の症状",
        key: "ether",
        text:
          (p.d.med >= 0.5 ? "" : p.d.name + "の診療所で、") +
          "検査で侵蝕度が高いと言われました。皮膚に結晶のような斑点が出ています。",
        opts: [
          {
            id: "ether.treat",
            t: "stable",
            label: "高額な治療を受ける",
            sub:
              p.d.med >= 0.5
                ? "侵蝕が大きく下がる。費用 400万"
                : "近くに専門の病院がない。遠くへ通う。費用 400万",
            fx: p => {
              p.money -= 400;
              p.eth = clamp(p.eth - Math.round(25 + p.d.med * 20));
              p.flags.treated = 1;
              say(p, "侵蝕抑制の治療を受けた。", "good");
            },
          },
          hollowWork
            ? {
                id: "ether.quit",
                t: "change",
                label: "仕事を変えてホロウから離れる",
                sub: "収入は減る",
                fx: p => {
                  if( ["raider", "police", "build", "gang"].includes(p.job) ){
                    p.job = "shop";
                  }
                  p.proxy = false;
                  p.eth = clamp(p.eth - 10);
                  say(p, "ホロウに近づかない仕事に移った。");
                },
              }
            : p.d.id !== safe.id
              ? {
                  id: "ether.move",
                  t: "change",
                  label: safe.name + "へ引っ越す",
                  sub: "ホロウから遠い。家賃が重い",
                  fx: p => {
                    p.money -= 200;
                    p.d = safe;
                    p.eth = clamp(p.eth - 10);
                    say(p, "ホロウから遠い" + safe.name + "に移った。");
                  },
                }
              : {
                  id: "ether.indoors",
                  t: "wait",
                  label: "外出を控える",
                  sub: "できるだけホロウに近づかない",
                  fx: p => {
                    p.eth = clamp(p.eth - 5);
                    p.hap = clamp(p.hap - 3);
                    say(p, "ホロウに近い場所へは行かないようにした。");
                  },
                },
          working
            ? {
                id: "ether.endure",
                t: "keep",
                label: "我慢して働く",
                sub: "いまの暮らしを守る",
                fx: p => {
                  p.flags.ignoreEth = 1;
                  say(p, "症状を隠して働き続けた。", "eth");
                },
              }
            : {
                id: "ether.wait",
                t: "wait",
                label: "様子を見る",
                sub: "いまの暮らしを変えない",
                fx: p => {
                  p.flags.ignoreEth = 1;
                  say(p, "症状のことは、誰にも言わなかった。", "eth");
                },
              },
        ],
      };
    },
    /* 共生ホロウ災害。10歳未満は大人に連れられて避難する一択。 */
    disaster: p => ({
      title: "共生ホロウ災害",
      key: "disaster",
      text: p.d.name + "の一角にホロウが発生しました。避難警報が鳴っています。",
      opts:
        p.age < 10
          ? [
              {
                id: "disaster.carried",
                t: "entrust",
                label: "大人に連れられて避難する",
                sub: "まだ自分では選べない",
                fx: p => {
                  if( R() < 0.03 ){
                    die(p, "共生ホロウ災害");
                  }else{
                    p.money -= 60;
                    p.hap = clamp(p.hap - 6);
                    say(p, "大人に抱えられて避難所に入り、数週間を過ごした。");
                  }
                },
              },
            ]
          : [
              {
                id: "disaster.flee",
                t: "flee",
                label: "すぐに避難する",
                sub: "安全を優先",
                fx: p => {
                  if( R() < 0.03 ){
                    die(p, "共生ホロウ災害");
                  }else{
                    p.money -= 60;
                    p.hap = clamp(p.hap - 6);
                    say(p, "避難所で数週間を過ごした。");
                  }
                },
              },
              {
                id: "disaster.back",
                t: "help",
                label: "家族や近所の人を探しに戻る",
                sub: "人間関係が深まる。危険",
                fx: p => {
                  p.eth = clamp(p.eth + 18 * (1.4 - p.apt / 100));
                  if( R() < 0.12 ){
                    die(p, "共生ホロウ災害");
                  }else{
                    p.rel = clamp(p.rel + 15);
                    say(p, "逃げ遅れた隣人を連れ出した。", "good big");
                  }
                },
              },
            ],
    }),
    /*
    ** 旧都陥落（範囲の中）。alarm で画面に警報の演出を出す。
    ** 年齢で選択肢が変わる。
    **
    **   0〜9歳    自分では選べない
    **   10〜13歳  子どもの選択
    **   14〜39歳  おとなの選択
    **   40歳〜    家族や財産をかかえた選択
    **
    ** 家族がすでに消息不明なら D.fallAlone に任せる。
    */
    fall: p => {
      if( p.flags.familyLost ){
        return D.fallAlone(p);
      }
      const base = {
        title: "旧都陥落",
        key: "fall",
        alarm: "near",
        text:
          "かつてない規模のホロウが都市を飲み込もうとしています。街じゅうが逃げ惑っています。" +
          armyLine(),
      };
      const a = p.age,
        tol = 1.4 - p.apt / 100;
      /*
      ** 逃げる選択肢の fx を作る。確率 rate で亡くなり、生き延びたら
      ** 移り住んで記録に line を残す。
      */
      const flee = (rate, line) => p => {
        if( R() < rate ){
          die(p, "旧都陥落");
        }else{
          fallSurvive(p);
          say(p, line, "big");
        }
      };
      const stay = {
        id: "fall.stay",
        t: "help",
        label: "残って人を助ける",
        sub: "多くを救えるかもしれない",
        fx: p => {
          p.eth = clamp(p.eth + 30 * tol);
          if( R() < 0.35 ){
            die(p, "旧都陥落");
          }else{
            fallSurvive(p);
            p.rel = clamp(p.rel + 20);
            p.hap = clamp(p.hap - 10);
            say(p, "最後の避難車両で脱出した。多くの顔を覚えている。", "big");
          }
        },
      };
      if( a < 10 ){
        return {
          ...base,
          text: base.text + "まだ幼いあなたに、選べることはありません。",
          opts: [
            {
              id: "fall.hand",
              t: "entrust",
              label: "親の手を握る",
              sub: "大人たちに任せる",
              fx: flee(0.2, "親に手を引かれて、避難の列に並んだ。"),
            },
          ],
        };
      }
      if( a < 14 ){
        return {
          ...base,
          opts: [
            {
              id: "fall.close",
              t: "flee",
              label: "家族とはぐれないようにする",
              sub: "手を離さない",
              fx: flee(0.17, "家族の背中だけを見て歩き、新しい都市に着いた。"),
            },
            {
              id: "fall.friend",
              t: "help",
              label: "友だちを探しに戻る",
              sub: "見つけられるかもしれない。危険",
              fx: p => {
                p.eth = clamp(p.eth + 25 * tol);
                if( R() < 0.32 ){
                  die(p, "旧都陥落");
                }else{
                  fallSurvive(p);
                  p.rel = clamp(p.rel + 15);
                  p.hap = clamp(p.hap - 8);
                  say(p, "友だちの手を引いて、最後の列に紛れ込んだ。", "big");
                }
              },
            },
          ],
        };
      }
      if( a < 40 ){
        return {
          ...base,
          opts: [
            {
              id: "fall.flee",
              t: "flee",
              label: "避難の列に並ぶ",
              sub: "生き延びることだけを考える",
              fx: flee(0.18, "すべてを置いて、新しい都市へ逃れた。"),
            },
            stay,
          ],
        };
      }
      const fam = p.married || p.kids > 0;
      return {
        ...base,
        opts: [
          {
            id: "fall.flee",
            t: "flee",
            label: "避難の列に並ぶ",
            sub: "生き延びることだけを考える",
            fx: flee(0.18, "すべてを置いて、新しい都市へ逃れた。"),
          },
          fam
            ? {
                id: "fall.famfirst",
                t: "help",
                label: "家族を先に逃がす",
                sub: "自分は最後になる",
                fx: p => {
                  p.eth = clamp(p.eth + 20 * tol);
                  if( R() < 0.3 ){
                    die(p, "旧都陥落");
                  }else{
                    fallSurvive(p);
                    p.rel = clamp(p.rel + 20);
                    say(
                      p,
                      "家族を先に車に乗せた。少し遅れて、同じ都市にたどり着いた。",
                      "big"
                    );
                  }
                },
              }
            : {
                id: "fall.neighbors",
                t: "help",
                label: "近所の人を連れて逃げる",
                sub: "足の遅い人に合わせる",
                fx: p => {
                  if( R() < 0.25 ){
                    die(p, "旧都陥落");
                  }else{
                    fallSurvive(p);
                    p.rel = clamp(p.rel + 15);
                    say(p, "隣の老人の荷物を背負って、一緒に歩いた。", "big");
                  }
                },
              },
          {
            id: "fall.goods",
            t: "guard",
            label:
              p.job === "owner" ? "店を守ろうとする" : "家財を持ち出そうとする",
            sub: "財産を少しでも残せる。危険",
            fx: p => {
              if( R() < 0.4 ){
                die(p, "旧都陥落");
              }else{
                const kept = p.money;
                fallSurvive(p);
                p.money = Math.round(kept * 0.6);
                say(p, "持てるだけのものを抱えて逃れた。", "big");
              }
            },
          },
        ],
      };
    },
  };

  /*
  ** 旧都陥落（範囲の外）。遠くで旧都が飲まれていくのを見ている。
  ** 決断のあとは避難民が流れ込み、地元の治安と災害が少し悪くなる
  ** （fallWitness）。家族がすでに消息不明なら D.fallFarAlone に任せる。
  */
  D.fallFar = p => {
    if( p.flags.familyLost ){
      return D.fallFarAlone(p);
    }
    const base = {
      title: "旧都陥落",
      key: "fallFar",
      alarm: "far",
      text:
        "旧都の方角の空に、見たことのない規模のホロウが広がっていきます。夜には、避難してきた人の列が" +
        p.d.name +
        "にも届きはじめました。" +
        yamaLine(p),
    };
    const a = p.age;
    if( a < 10 ){
      return {
        ...base,
        opts: [
          {
            id: "fallFar.adults",
            t: "entrust",
            label: "大人たちのそばにいる",
            sub: "何が起きているのかは、まだわからない",
            fx: p => {
              fallWitness(p);
              say(p, "大人たちが、遠くの空を見て黙っていた。");
            },
          },
        ],
      };
    }
    if( a < 14 ){
      return {
        ...base,
        opts: [
          {
            id: "fallFar.cook",
            t: "share",
            label: "炊き出しを手伝う",
            sub: "できることをする",
            fx: p => {
              p.rel = clamp(p.rel + 10);
              fallWitness(p);
              say(
                p,
                "避難してきた子どもたちに、汁物をよそって回った。",
                "good big"
              );
            },
          },
          {
            id: "fallFar.watch",
            t: "wait",
            label: "遠くの空を見ていた",
            sub: "目が離せない",
            fx: p => {
              p.hap = clamp(p.hap - 3);
              fallWitness(p);
              say(p, "旧都の方角の空を、毎晩眺めていた。");
            },
          },
        ],
      };
    }
    return {
      ...base,
      opts: [
        {
          id: "fallFar.share",
          t: "share",
          label: "受け入れて食料を分ける",
          sub: "人間関係が深まる。貯えが減る",
          fx: p => {
            p.money -= 80;
            p.rel = clamp(p.rel + 15);
            p.hap = clamp(p.hap + 3);
            fallWitness(p);
            say(p, "避難してきた家族を家に迎えた。", "good big");
          },
        },
        {
          id: "fallFar.distance",
          t: "shut",
          label: "距離を置く",
          sub: "いまの暮らしを守る",
          fx: p => {
            p.hap = clamp(p.hap - 3);
            fallWitness(p);
            say(p, "戸を閉めて、しばらく外に出なかった。");
          },
        },
        {
          id: "fallFar.search",
          t: "help",
          label: "旧都へ人を探しに行く",
          sub: "侵蝕と命の危険",
          fx: p => {
            p.eth = clamp(p.eth + 20 * (1.4 - p.apt / 100));
            if( R() < 0.08 ){
              die(p, "旧都陥落");
            }else{
              fallWitness(p);
              p.rel = clamp(p.rel + 20);
              p.hap = clamp(p.hap - 8);
              say(p, "旧都の縁まで行き、はぐれた人を連れ帰った。", "big");
            }
          },
        },
        ...(p.job === "owner"
          ? [
              {
                id: "fallFar.shopcook",
                t: "share",
                label: "店を開けて炊き出しをする",
                sub: "貯えは大きく減る",
                fx: p => {
                  p.money -= 150;
                  p.rel = clamp(p.rel + 20);
                  p.hap = clamp(p.hap + 4);
                  fallWitness(p);
                  say(
                    p,
                    "店の鍋を総動員して、避難してきた人に配った。",
                    "good big"
                  );
                },
              },
            ]
          : []),
      ],
    };
  };

  /* ===== 陥落の時点で、自分以外の家族がすでに消息不明 ===== */

  /* 陥落の時点で、自分以外の家族がすでに消息不明になっている割合 */
  const FAMILY_LOST_RATE = 0.15;

  /*
  ** 「低い確率で起きる」展開の確率（局員への裏稼業の誘い、
  ** 家族を失って間もない人の長い付き合いの相手）。
  */
  const RARE = 0.15;

  /*
  ** p の家族（親・配偶者・子ども）が消息不明になる。幸福が下がり、
  ** 記録に残す。すでに消息不明なら何もしない。
  */
  function loseFamily(p){
    if( p.flags.familyLost ){
      return;
    }
    p.flags.familyLost = 1;
    p.married = false;
    p.kids = 0;
    p.hap = clamp(p.hap - 15);
    say(
      p,
      p.d.zone === "inside"
        ? "家族の消息が途絶えた。"
        : "家族はその日、旧都に出かけていた。連絡がつかない。",
      "bad big"
    );
  }

  /*
  ** 旧都陥落（範囲の中・家族がすでに消息不明）。0〜9歳は見知らぬ大人に
  ** 手を引かれる一択。10〜13歳と14歳〜は家族を探すかどうか。
  ** 40歳〜は家財や店を守る選択肢も出る。
  */
  D.fallAlone = p => {
    const base = {
      title: "旧都陥落",
      key: "fallAlone",
      alarm: "near",
      text:
        "かつてない規模のホロウが都市を飲み込もうとしています。家族の姿は、もうどこにもありません。" +
        armyLine(),
    };
    const a = p.age,
      tol = 1.4 - p.apt / 100;
    /* 逃げる選択肢の fx を作る（D.fall の flee と同じ）。 */
    const flee = (rate, line) => p => {
      if( R() < rate ){
        die(p, "旧都陥落");
      }else{
        fallSurvive(p);
        say(p, line, "big");
      }
    };
    /*
    ** 家族を探す選択肢の fx を作る。侵蝕が eth（適性で増減）増え、
    ** 確率 rate で亡くなり、生き延びたら記録に line を残す。
    */
    const search = (rate, eth, line) => p => {
      p.eth = clamp(p.eth + eth * tol);
      if( R() < rate ){
        die(p, "旧都陥落");
      }else{
        fallSurvive(p);
        p.hap = clamp(p.hap - 10);
        say(p, line, "big");
      }
    };
    if( a < 10 ){
      return {
        ...base,
        text: base.text + "まだ幼いあなたに、選べることはありません。",
        opts: [
          {
            id: "fallAlone.stranger",
            t: "entrust",
            label: "知らない大人の手を握る",
            sub: "誰かが手を差し出している",
            fx: flee(0.25, "見知らぬ大人に手を引かれて、避難の列に並んだ。"),
          },
        ],
      };
    }
    if( a < 14 ){
      return {
        ...base,
        opts: [
          {
            id: "fallAlone.flee",
            t: "flee",
            label: "ひとりで避難の列を探す",
            sub: "大人たちの流れについていく",
            fx: flee(
              0.22,
              "大人たちの流れに紛れて、新しい都市にたどり着いた。"
            ),
          },
          {
            id: "fallAlone.home",
            t: "search",
            label: "家族を探しに家へ戻る",
            sub: "誰かいるかもしれない。危険",
            fx: search(0.4, 30, "家には誰もいなかった。最後の列に飛び乗った。"),
          },
        ],
      };
    }
    return {
      ...base,
      opts: [
        {
          id: "fallAlone.flee",
          t: "flee",
          label: "避難の列に並ぶ",
          sub: "家族を信じて先に逃げる",
          fx: flee(0.18, "家族の名前を呼びながら、避難の列に並んだ。"),
        },
        {
          id: "fallAlone.search",
          t: "search",
          label: "家族を探しに残る",
          sub: "見つけられるかもしれない。危険",
          fx: search(
            0.4,
            30,
            "心当たりを探し回ったが、誰も見つからなかった。最後の避難車両で脱出した。"
          ),
        },
        ...(a >= 40
          ? [
              {
                id: "fallAlone.goods",
                t: "guard",
                label:
                  p.job === "owner"
                    ? "店を守ろうとする"
                    : "家財を持ち出そうとする",
                sub: "家族が戻る場所を残したい。危険",
                fx: p => {
                  if( R() < 0.4 ){
                    die(p, "旧都陥落");
                  }else{
                    const kept = p.money;
                    fallSurvive(p);
                    p.money = Math.round(kept * 0.6);
                    say(
                      p,
                      "持てるだけのものを抱えて逃れた。家族の写真も入れた。",
                      "big"
                    );
                  }
                },
              },
            ]
          : []),
      ],
    };
  };

  /*
  ** 旧都陥落（範囲の外・家族がすでに消息不明）。家族はその日旧都に
  ** 出かけていて、連絡がつかない。
  */
  D.fallFarAlone = p => {
    const base = {
      title: "旧都陥落",
      key: "fallFarAlone",
      alarm: "far",
      text:
        "旧都の方角の空に、見たことのない規模のホロウが広がっていきます。家族はその日、旧都に出かけていて、連絡がつきません。" +
        yamaLine(p),
    };
    const a = p.age,
      tol = 1.4 - p.apt / 100;
    if( a < 10 ){
      return {
        ...base,
        opts: [
          {
            id: "fallFarAlone.adults",
            t: "entrust",
            label: "大人たちのそばにいる",
            sub: "家族の帰りを待つ",
            fx: p => {
              fallWitness(p);
              say(p, "家族は帰ってこなかった。近所の家に引き取られた。");
            },
          },
        ],
      };
    }
    const lines = {
      id: "fallFarAlone.lines",
      t: "search",
      label: "避難民の列に家族を探す",
      sub: "毎日、名簿と顔を確かめる",
      fx: p => {
        p.rel = clamp(p.rel + 5);
        p.hap = clamp(p.hap - 5);
        fallWitness(p);
        say(p, "毎日、避難民の列に家族の顔を探した。");
      },
    };
    if( a < 14 ){
      return {
        ...base,
        opts: [
          lines,
          {
            id: "fallFarAlone.home",
            t: "wait",
            label: "家で帰りを待つ",
            sub: "灯りをつけたままにしておく",
            fx: p => {
              p.hap = clamp(p.hap - 5);
              fallWitness(p);
              say(p, "家の灯りをつけたまま、帰りを待ち続けた。");
            },
          },
        ],
      };
    }
    return {
      ...base,
      opts: [
        {
          id: "fallFarAlone.go",
          t: "search",
          label: "旧都へ家族を探しに行く",
          sub: "侵蝕と命の危険",
          fx: p => {
            p.eth = clamp(p.eth + 25 * tol);
            if( R() < 0.12 ){
              die(p, "旧都陥落");
            }else{
              fallWitness(p);
              p.hap = clamp(p.hap - 10);
              say(p, "旧都の縁まで行ったが、家族は見つからなかった。", "big");
            }
          },
        },
        lines,
        {
          id: "fallFarAlone.home",
          t: "wait",
          label: "家で帰りを待つ",
          sub: "灯りをつけたままにしておく",
          fx: p => {
            p.hap = clamp(p.hap - 5);
            fallWitness(p);
            say(p, "家の灯りをつけたまま、帰りを待ち続けた。");
          },
        },
      ],
    };
  };

  /*
  ** 範囲の外で陥落を見届けた p の地区を、避難民の流入のあとの姿に変える。
  ** 治安・災害・曝露が少し悪くなり、病院が混んで医療が少し下がる。
  ** 地区の表（DISTRICTS）は変えず、p.d を写しに差し替える。
  */
  function fallWitness(p){
    p.flags.witness = 1;
    p.d = {
      ...p.d,
      crime: clamp(p.d.crime + 0.1, 0, 1),
      dis: p.d.dis * 1.3,
      exp: p.d.exp + 0.05,
      med: clamp(p.d.med - 0.05, 0, 1),
    };
  }
  /*
  ** 範囲の中から生き延びた p を移り住ませる。行き先は新都の側
  ** （仮設住宅 50% か六分街 30%）か郊外 20%。貯えの多くと幸福を失う。
  */
  function fallSurvive(p){
    const r = R(),
      to = r < 0.5 ? "camp" : r < 0.8 ? "rokubun" : "outer";
    p.d = DISTRICTS.find(x => x.id === to);
    p.money = Math.round(p.money * 0.2);
    p.hap = clamp(p.hap - 20);
    p.flags.survivor = 1;
    /*
    ** 店は旧都に残してくるので、店主ではなくなる
    ** （新しい都市では商店街で働く）。
    */
    if( p.job === "owner" ){
      p.job = "shop";
      p.flags.lostShop = 1;
      say(p, "店は旧都に残してきた。", "bad");
    }
  }

  /* エーテル適性 a（0〜100）を、検査結果の言葉にして返す。 */
  function aptLabel(a){
    return a >= 75 ? "高い" : a >= 45 ? "ふつう" : "低い";
  }

  /*
  ** 決断 dec の選択肢を一つランダムに選んで p に当て、選んだ選択肢を返す
  ** （同じ1秒に生まれた人たち・一括シミュレーション用）。
  */
  function autoChoose(p, dec){
    const o = pick(dec.opts);
    o.fx(p);
    return o;
  }

  /* ===== ランダムな出来事 ===== */

  /*
  ** 年ごとのランダムな出来事の表。p(人) はその年に起きる確率を返し、
  ** fx(人) は起きたときに人を変える。step が毎年すべてを試す。
  */
  const EVENTS = [
    /* 学校でのいじめ。シリオンは2倍起きやすい。 */
    {
      p: p => (p.age >= 6 && p.age <= 14 ? 0.08 * (p.thiren ? 2 : 1) : 0),
      fx: p => {
        p.hap = clamp(p.hap - 8);
        p.rel = clamp(p.rel - 5);
        say(
          p,
          p.thiren
            ? "耳としっぽのことで、クラスでからかわれた。"
            : "学校で居場所をなくした時期があった。",
          "bad"
        );
      },
    },
    /* レンタルビデオ店で映画を観る（子ども時代）。 */
    {
      p: p => (p.age >= 3 && p.age <= 12 ? 0.06 : 0),
      fx: p => {
        p.know = clamp(p.know + 6);
        p.hap = clamp(p.hap + 4);
        say(p, "レンタルビデオ店に入り浸り、古い映画を片っ端から観た。");
      },
    },
    /* 近所の人と親しくなる。 */
    {
      p: p => (p.age >= 8 ? 0.05 : 0),
      fx: p => {
        p.rel = clamp(p.rel + 6);
        say(p, "近所の人と親しくなった。", "good");
      },
    },
    /* 交通事故で入院する。 */
    {
      p: p => (p.age >= 16 ? 0.04 : 0),
      fx: p => {
        hurt(p, 12);
        p.money -= 50;
        say(p, "交通事故で入院した。", "bad");
      },
    },
    /* ひったくり。治安が悪い地区ほど起きやすい。 */
    {
      p: p => (p.age >= 18 ? 0.03 * (0.5 + p.d.crime) : 0),
      fx: p => {
        p.money -= Math.round(40 + R() * 80);
        p.hap = clamp(p.hap - 5);
        say(p, "ひったくりにあった。", "bad");
      },
    },
    /* アーケードの大会で賞金を取る。 */
    {
      p: p => (p.age >= 20 ? 0.03 : 0),
      fx: p => {
        p.money += 150;
        p.hap = clamp(p.hap + 5);
        say(p, "アーケードの大会で賞金を取った。", "good");
      },
    },
    /* 夫婦関係がこじれる。4割は離婚する。 */
    {
      p: p => (p.age >= 30 && p.married ? 0.04 : 0),
      fx: p => {
        p.rel = clamp(p.rel - 15);
        p.hap = clamp(p.hap - 10);
        if( R() < 0.4 ){
          p.married = false;
          say(p, "離婚した。", "bad");
        }else{
          say(p, "夫婦関係がぎくしゃくした。", "bad");
        }
      },
    },
    /* 健康診断で再検査になる。 */
    {
      p: p => (p.age >= 40 ? 0.05 : 0),
      fx: p => {
        hurt(p, 10);
        say(p, "健康診断で再検査になった。", "bad");
      },
    },
    /* ホロウレイダーがエーテル資源を掘り当てる。 */
    {
      p: p => (p.age >= 18 && p.job === "raider" ? 0.12 : 0),
      fx: p => {
        p.money += 300;
        p.eth = clamp(p.eth + 6);
        say(p, "ホロウの奥でエーテル資源を掘り当てた。", "eth");
      },
    },
    /* 裏稼業の依頼。3割は治安局に目をつけられて手を引く。 */
    {
      p: p => (p.proxy ? 0.1 : 0),
      fx: p => {
        if( R() < 0.3 ){
          p.money -= 200;
          p.proxy = false;
          p.hap = clamp(p.hap - 10);
          say(p, "治安局に目をつけられ、裏稼業から手を引いた。", "bad big");
        }else{
          p.money += 120;
          say(p, "道案内の依頼をひとつ片付けた。");
        }
      },
    },
    /* ギャングの縄張り争い。 */
    {
      p: p => (p.age >= 20 && p.job === "gang" ? 0.08 : 0),
      fx: p => {
        if( R() < 0.2 ){
          die(p, "抗争");
        }else{
          hurt(p, 15);
          say(p, "縄張り争いで大けがをした。", "bad");
        }
      },
    },
    /* 子どもの成長を見届ける。 */
    {
      p: p => (p.age >= 25 && p.kids ? 0.05 : 0),
      fx: p => {
        p.hap = clamp(p.hap + 8);
        p.rel = clamp(p.rel + 5);
        say(p, "子どもの成長を見届けた。", "good");
      },
    },
    /* ひとりの老後の寂しさ。 */
    {
      p: p => (p.age >= 60 && !p.married && !p.flags.bangboo ? 0.08 : 0),
      fx: p => {
        p.hap = clamp(p.hap - 6);
        say(p, "誰とも話さない日が増えた。", "bad");
      },
    },
    /* ボンプとの老後。 */
    {
      p: p => (p.age >= 60 && p.flags.bangboo ? 0.06 : 0),
      fx: p => {
        p.hap = clamp(p.hap + 5);
        say(p, "ボンプの部品を取り替えた。まだ一緒にいられる。", "good");
      },
    },
    /* 夜間の講座で資格を取る。教育の水準しだい。 */
    {
      p: p => (p.age >= 25 ? 0.01 + 0.02 * p.d.edu : 0),
      fx: p => {
        p.know = clamp(p.know + 8);
        say(p, "夜間の講座に通い、資格を取った。", "good");
      },
    },
    /* 陥落で家族が消息不明になった人が、家族の一人と再会する（毎年 2%）。 */
    {
      p: p =>
        p.flags.familyLost && !p.flags.reunited && p.age > p.fallAge ? 0.02 : 0,
      fx: p => {
        p.flags.reunited = 1;
        p.rel = clamp(p.rel + 15);
        p.hap = clamp(p.hap + 15);
        say(
          p,
          "避難民の名簿で、家族の一人の名前を見つけた。再会できた。",
          "good big"
        );
      },
    },
  ];

  /* ===== 1年進める ===== */

  /*
  ** p を1年進める。年齢・学業・収入と支出・侵蝕・状態値を動かし、
  ** 出来事（EVENTS）とホロウ災害を試し、最後に死亡判定をする。
  ** 死亡率はゴンペルツ型の基礎死亡率 × 健康と医療の補正 ＋ 仕事などの
  ** 追加リスク。侵蝕度が100に届いたらエーテリアス化で亡くなる。
  ** 人生地図用に、この年の印（l 生きた / e 侵蝕60以上 / x 亡くなった）を
  ** p.years に足す。決断は出さない（decisionFor を別に呼ぶ）。
  */
  function step(p){
    if( !p.alive ){
      return;
    }
    p.age++;
    const j = JOBS[p.job];
    /* 教育の流れ */
    if( p.age === 6 ){
      p.job = "student";
      say(p, "学校に通いはじめた。");
    }
    if( p.job === "student" ){
      p.know = clamp(p.know + 1 + p.d.edu * 4);
    }
    if( p.flags.study && p.age === 18 ){
      p.know = clamp(p.know + 5);
    }
    /* 収入 */
    let inc =
      j.inc * (0.7 + p.know / 200) * (p.thiren && p.job === "corp" ? 0.9 : 1);
    if( p.proxy ){
      inc += 180;
    }
    if( p.flags.oldwork && p.age >= 62 ){
      inc += 150;
    }
    if( p.age < 18 ){
      inc = 0;
    }
    const cost = p.age >= 18 ? 120 + p.d.wealth * 120 + p.kids * 40 : 0;
    p.money += Math.round(inc - cost);
    /* 侵蝕 */
    const tol = 1.4 - p.apt / 100;
    let e = (p.d.exp * 1.2 + j.eth + (p.proxy ? 2.5 : 0)) * tol;
    /* 侵蝕の自然な抜けは、通える医療しだい */
    e -= (p.flags.treated ? 0.6 : 0) + 0.3 + 0.6 * p.d.med;
    p.eth = clamp(p.eth + e);
    /* 状態 */
    const ageDecay = p.age > 40 ? (p.age - 40) * 0.05 : 0;
    p.hp = clamp(
      p.hp -
        ageDecay -
        (p.eth > 50 ? (p.eth - 50) * 0.06 : 0) +
        (p.age < 30 ? 0.4 : 0) -
        (p.money < 0 ? 1 : 0)
    );
    p.hap = clamp(
      p.hap +
        j.hap * 0.3 +
        (p.money < 0 ? -2 : 0) +
        (p.rel - 50) * 0.03 +
        (p.hp - 50) * 0.02
    );
    p.rel = clamp(p.rel + (p.married ? 0.4 : -0.2));
    /* 出来事 */
    for(const ev of EVENTS){
      if( p.alive && R() < ev.p(p) ){
        ev.fx(p);
      }
    }
    /* ホロウ災害 */
    if( p.alive && !p.flags.disaster && R() < p.d.dis ){
      p.flags.disaster = 1;
      say(p, p.d.name + "でホロウ災害が起きた。", "bad big");
    }else if( p.flags.disDone && R() < p.d.dis ){
      p.flags.disaster = 1;
      p.flags.disDone = 0;
    }
    /* エーテリアス化 */
    if( p.alive && p.eth >= 100 ){
      die(p, "エーテリアス化");
      return;
    }
    /* 死亡判定 */
    if( p.alive ){
      const base =
        p.age < 1
          ? 0.004
          : p.age < 5
            ? 0.0008
            : 0.00003 * Math.exp(0.095 * p.age);
      /* 幼い子ほど医療の差が出る（ルミナスクエア 0.52 · 郊外 1.42） */
      const care = p.age < 5 ? 1.6 - 1.2 * p.d.med : careF(p);
      let q =
        base * (1.7 - p.hp / 100) * care +
        j.haz +
        (p.proxy ? 0.003 : 0) +
        p.d.crime * 0.0006;
      if( p.flags.oldwork && p.age >= 62 ){
        q *= 1.1;
      }
      if( R() < q ){
        die(p, naturalCause(p));
      }
    }
    p.years.push(p.alive ? (p.eth >= 60 ? "e" : "l") : "x");
  }

  /* step の死亡判定で亡くなった p の死因を、年齢と仕事から選んで返す。 */
  function naturalCause(p){
    const j = p.job;
    if( p.age >= 78 ){
      return pick(["老衰", "老衰", "心不全", "肺炎"]);
    }
    if( p.age >= 50 ){
      return pick(["がん", "心臓病", "脳卒中", "がん"]);
    }
    if( j === "raider" ){
      return pick(["ホロウ内での事故", "エーテリアスの襲撃"]);
    }
    if( j === "police" ){
      return pick(["職務中の事故", "エーテリアスの襲撃"]);
    }
    if( j === "build" ){
      return "現場での事故";
    }
    if( j === "gang" ){
      return "抗争";
    }
    if( p.age < 5 ){
      return "感染症";
    }
    return pick(["交通事故", "病気", "不慮の事故"]);
  }

  /*
  ** p を cause で亡くなったことにし、記録に残す。
  ** すでに亡くなっていれば何もしない。
  */
  function die(p, cause){
    if( !p.alive ){
      return;
    }
    p.alive = false;
    p.cause = cause;
    const t =
      cause === "エーテリアス化"
        ? "侵蝕が限界を超えた。治安局の記録に、身元確認済みの一件として残った。"
        : cause + "で亡くなった。";
    say(p, t, "bad big");
  }

  /*
  ** p を、決断をランダムに選びながら最期まで流して返す（並走する4人の
  ** 後始末と一括シミュレーション用）。maxYears 年で打ち切る。
  ** onDecision を渡すと、決断のたびに (人, 決断, 選んだ選択肢) で呼ぶ。
  */
  function runToEnd(p, maxYears = 120, onDecision){
    let guard = 0;
    while( p.alive && guard++ < maxYears ){
      step(p);
      const d = decisionFor(p);
      if( d ){
        const o = autoChoose(p, d);
        if( onDecision ){
          onDecision(p, d, o);
        }
      }
    }
    return p;
  }

  Object.assign(E, {
    rnd,
    clamp,
    level,
    pick,
    fmt,
    newPerson,
    say,
    decisionFor,
    D,
    KINDS,
    aptLabel,
    autoChoose,
    EVENTS,
    step,
    naturalCause,
    die,
    runToEnd,
  });
})(globalThis.Eridu = globalThis.Eridu || {});
