/*
** データ：地区・名前・仕事。
** ブラウザでも Node でも読める（globalThis.Eridu に載せる）。
** 地名・時代ごとの扱い・公式の扱いは docs/setting.md。
*/
(function(E){
  /*
  ** 出生地区と、住所として移り住む先。
  **
  **   wealth  暮らし向き
  **   exp     エーテル曝露
  **   crime   治安の悪さ
  **   edu     教育環境
  **   med     医療（病院の近さと質）
  **   dis     年間ホロウ災害率
  **   w       いまの時代の出生の重み
  **   old     旧都陥落前の出生の重み（0 ならその時代には生まれない）
  **   zone    旧都陥落のときに "inside"（飲まれる範囲＝のちの零号ホロウ）か
  **           "outside"（範囲外）か
  **   sky     旧都陥落の演出で出すスカイラインの種類（js/skyline.js）
  **
  ** wealth から dis までは 0〜1。時代と場所の設定は CLAUDE.md の表を参照。
  */
  E.DISTRICTS = [
    /*
    ** いまの時代。六分街とルミナスクエアはヤヌス区の一画、澄輝坪と泅瓏囲は
    ** 衛非地区の町（名前は「区・街」の形で出す）。
    */
    {
      id: "rokubun", name: "ヤヌス区・六分街",
      desc: "小さな下町。住みやすい街の上位常連",
      w: 20, old: 0, zone: "outside", sky: "shops",
      wealth: 0.5, exp: 0.2, crime: 0.25, edu: 0.5,
      med: 0.45, dis: 0.006,
    },
    {
      id: "center", name: "ヤヌス区・ルミナスクエア",
      desc: "ヤヌス区の中心の商業地帯。港もある",
      w: 15, old: 0, zone: "outside", sky: "towers",
      wealth: 0.85, exp: 0.08, crime: 0.15, edu: 0.85,
      med: 0.9, dis: 0.003,
    },
    {
      id: "kokugan", name: "黒雁街跡地",
      desc: "旧都に近い工業区。重工業の現場が並ぶ",
      w: 11, old: 0, zone: "outside", sky: "works",
      wealth: 0.35, exp: 0.55, crime: 0.4, edu: 0.35,
      med: 0.35, dis: 0.012,
    },
    {
      id: "canvas", name: "カンバス通り",
      desc: "旧都に近い貧民街。共生ホロウで新都への道が絶たれている",
      w: 8, old: 0, zone: "outside", sky: "outer",
      wealth: 0.15, exp: 0.5, crime: 0.7, edu: 0.2,
      med: 0.2, dis: 0.015,
    },
    {
      id: "camp", name: "避難民の仮設住宅",
      desc: "旧都から逃れた人々の街区",
      w: 10, old: 0, zone: "outside", sky: "camp",
      wealth: 0.1, exp: 0.55, crime: 0.55, edu: 0.15,
      med: 0.2, dis: 0.014,
    },
    /* 両方の時代 */
    {
      id: "elpis", name: "ポート・エルピス",
      desc: "大海原と大橋を望む小さな埠頭。陥落の後に廃れかけた",
      w: 8, old: 6, zone: "outside", sky: "port",
      wealth: 0.4, exp: 0.3, crime: 0.45, edu: 0.4,
      med: 0.4, dis: 0.008,
    },
    {
      id: "outer", name: "郊外",
      desc: "荒野と点在する集落",
      w: 11, old: 12, zone: "outside", sky: "outer",
      wealth: 0.2, exp: 0.75, crime: 0.6, edu: 0.25,
      med: 0.15, dis: 0.02,
    },
    {
      id: "waifei", name: "衛非地区・澄輝坪",
      desc: "海辺の岩山に築かれた古い町。輝磁の産地",
      w: 10, old: 12, zone: "outside", sky: "hillside",
      wealth: 0.5, exp: 0.3, crime: 0.3, edu: 0.45,
      med: 0.45, dis: 0.009,
    },
    {
      id: "qiulong", name: "衛非地区・泅瓏囲",
      desc: "澄輝坪の真下、海蝕洞窟に築かれた下町",
      w: 5, old: 5, zone: "outside", sky: "zakkyo",
      wealth: 0.25, exp: 0.35, crime: 0.5, edu: 0.3,
      med: 0.3, dis: 0.01,
    },
    {
      id: "thronos", name: "スロノス区",
      desc: "リゾートビーチと施設が点在する地区",
      w: 8, old: 8, zone: "outside", sky: "sparse",
      wealth: 0.45, exp: 0.35, crime: 0.35, edu: 0.45,
      med: 0.6, dis: 0.01,
    },
    /*
    ** 旧都陥落の前だけ。新エリー都はもともと旧都の新開発地区の呼び名で、
    ** ヤヌス区はその市街地。陥落前の人は自分の街を「旧都」とは呼ばない
    ** ので「エリー都・〜」。範囲の中かどうかは画面で明言しない。
    */
    {
      id: "janus", name: "ヤヌス区",
      desc: "新開発地区「新エリー都」の市街地",
      w: 0, old: 14, zone: "outside", sky: "midrise",
      wealth: 0.6, exp: 0.25, crime: 0.3, edu: 0.6,
      med: 0.65, dis: 0.007,
    },
    {
      id: "kcenter", name: "エリー都・中心街",
      desc: "高層ビルの並ぶ都心。何でも揃う",
      w: 0, old: 18, zone: "inside", sky: "towers",
      wealth: 0.85, exp: 0.12, crime: 0.15, edu: 0.85,
      med: 0.9, dis: 0.004,
    },
    {
      id: "kshita", name: "エリー都・下町",
      desc: "商店と住宅の入り組んだ、人情のある街",
      w: 0, old: 22, zone: "inside", sky: "shops",
      wealth: 0.5, exp: 0.2, crime: 0.3, edu: 0.5,
      med: 0.55, dis: 0.006,
    },
    {
      id: "kzakkyo", name: "エリー都・雑居街",
      desc: "建て増しの重なる雑居ビルの街",
      w: 0, old: 16, zone: "inside", sky: "zakkyo",
      wealth: 0.3, exp: 0.3, crime: 0.55, edu: 0.3,
      med: 0.35, dis: 0.008,
    },
  ];

  /* 下の名前 */
  E.GIVEN = [
    "ハル", "ミオ", "レン", "トウマ", "サラ", "ユウキ", "カイ", "ノア", "リツ",
    "エマ", "ジン", "ルカ", "アオイ", "シオン", "ミナ", "テオ", "ユナ",
    "イツキ", "マオ", "ソラ",
  ];
  /* 名字 */
  E.FAMILY = [
    "アサギ", "クロセ", "ミナト", "ヒイラギ", "ソーン", "カトウ", "リー",
    "ヴァレン", "オルテガ", "ナギ", "シバ", "ローウェル", "タチバナ", "モリス",
  ];
  /* シリオンの種類 */
  E.THIREN_KIND = ["犬", "猫", "狼", "狐", "熊", "兎", "鮫", "鴉"];

  /*
  ** 仕事。
  **
  **   inc  年収（万ディニー）
  **   eth  年間侵蝕
  **   haz  年間の追加死亡率
  **   hap  幸福の増減
  */
  E.JOBS = {
    none: {name: "なし", inc: 0, eth: 0, haz: 0, hap: 0},
    student: {name: "学生", inc: 0, eth: 0, haz: 0, hap: 1},
    corp: {
      name: "ホロウ調査企業の社員",
      inc: 520, eth: 0.5, haz: 0.0005, hap: 0,
    },
    build: {name: "建設・解体の現場", inc: 330, eth: 2, haz: 0.002, hap: 1},
    police: {name: "治安局の局員", inc: 400, eth: 2.5, haz: 0.004, hap: 1},
    raider: {
      name: "無許可のホロウレイダー",
      inc: 700, eth: 7, haz: 0.012, hap: 2,
    },
    shop: {name: "商店街の店員", inc: 250, eth: 0, haz: 0, hap: 1},
    gang: {name: "バイクギャングの一員", inc: 180, eth: 2, haz: 0.01, hap: 2},
    owner: {name: "自分の店の店主", inc: 380, eth: 0, haz: 0, hap: 3},
    retired: {name: "引退", inc: 60, eth: 0, haz: 0, hap: 2},
  };
})(globalThis.Eridu = globalThis.Eridu || {});
