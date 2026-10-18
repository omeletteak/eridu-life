/* データ：地区・名前・仕事。ブラウザでも Node でも読める（globalThis.Eridu に載せる） */
(function(E){

/* 地区：wealth 暮らし向き / exp エーテル曝露 / crime 治安の悪さ / edu 教育環境 / dis 年間ホロウ災害率
   w = いまの時代の出生の重み / old = 旧都陥落前の出生の重み（0 ならその時代には生まれない）
   zone = 旧都陥落のときに "inside"（飲まれる範囲＝のちの零号ホロウ）か "outside"（範囲外）か
   sky = 旧都陥落の演出で出すスカイラインの種類（js/skyline.js）
   時代と場所の設定は CLAUDE.md の表を参照 */
E.DISTRICTS=[
 // いまの時代
 {id:"rokubun",name:"六分街",desc:"避難民が寄り集まってできた下町",w:20,old:0,zone:"outside",sky:"shops",wealth:.5,exp:.2,crime:.3,edu:.5,dis:.006},
 {id:"center",name:"中心区",desc:"高層ビル街",w:15,old:0,zone:"outside",sky:"towers",wealth:.85,exp:.08,crime:.15,edu:.85,dis:.003},
 {id:"port",name:"港湾地区",desc:"倉庫と貨物線",w:13,old:0,zone:"outside",sky:"port",wealth:.4,exp:.3,crime:.5,edu:.4,dis:.008},
 {id:"works",name:"再開発の工事区画",desc:"ホロウ跡地の再建現場",w:11,old:0,zone:"outside",sky:"works",wealth:.35,exp:.5,crime:.4,edu:.35,dis:.012},
 {id:"camp",name:"避難民の仮設住宅",desc:"旧都から逃れた人々の街区",w:12,old:0,zone:"outside",sky:"camp",wealth:.1,exp:.55,crime:.55,edu:.15,dis:.014},
 // 両方の時代
 {id:"outer",name:"郊外",desc:"ホロウ周縁の荒野と集落",w:11,old:12,zone:"outside",sky:"outer",wealth:.2,exp:.75,crime:.6,edu:.25,dis:.02},
 {id:"waifei",name:"衛非地区",desc:"地峡の先、半島の古い町並み",w:10,old:10,zone:"outside",sky:"waifei",wealth:.4,exp:.45,crime:.35,edu:.45,dis:.012},
 {id:"thronos",name:"スロノス区",desc:"広い土地に施設が点在する地区",w:8,old:8,zone:"outside",sky:"sparse",wealth:.45,exp:.35,crime:.35,edu:.45,dis:.01},
 // 旧都陥落の前だけ
 {id:"janus",name:"ヤヌス区",desc:"地峡に近い市街地",w:0,old:14,zone:"outside",sky:"midrise",wealth:.6,exp:.25,crime:.3,edu:.6,dis:.007},
 {id:"kcenter",name:"旧都の中心街",desc:"高層ビルの並ぶ都心",w:0,old:18,zone:"inside",sky:"towers",wealth:.85,exp:.12,crime:.15,edu:.85,dis:.004},
 {id:"kshita",name:"旧都の下町",desc:"商店と住宅の入り組んだ街",w:0,old:22,zone:"inside",sky:"shops",wealth:.5,exp:.2,crime:.3,edu:.5,dis:.006},
 {id:"kzakkyo",name:"旧都の雑居街",desc:"建て増しの重なる雑居ビルの街",w:0,old:16,zone:"inside",sky:"zakkyo",wealth:.3,exp:.3,crime:.55,edu:.3,dis:.008},
];

E.GIVEN=["ハル","ミオ","レン","トウマ","サラ","ユウキ","カイ","ノア","リツ","エマ","ジン","ルカ","アオイ","シオン","ミナ","テオ","ユナ","イツキ","マオ","ソラ"];
E.FAMILY=["アサギ","クロセ","ミナト","ヒイラギ","ソーン","カトウ","リー","ヴァレン","オルテガ","ナギ","シバ","ローウェル","タチバナ","モリス"];
E.THIREN_KIND=["犬","猫","狼","狐","熊","兎","鮫","鴉"];

/* 仕事：inc 年収(万ディニー) / eth 年間侵蝕 / haz 年間の追加死亡率 / hap 幸福の増減 */
E.JOBS={
 none:{name:"なし",inc:0,eth:0,haz:0,hap:0},
 student:{name:"学生",inc:0,eth:0,haz:0,hap:1},
 corp:{name:"ホロウ調査企業の社員",inc:520,eth:.5,haz:.0005,hap:0},
 build:{name:"建設・解体の現場",inc:330,eth:2,haz:.002,hap:1},
 police:{name:"治安局の局員",inc:400,eth:2.5,haz:.004,hap:1},
 raider:{name:"無許可のホロウレイダー",inc:700,eth:7,haz:.012,hap:2},
 shop:{name:"商店街の店員",inc:250,eth:0,haz:0,hap:1},
 gang:{name:"バイクギャングの一員",inc:180,eth:2,haz:.01,hap:2},
 owner:{name:"自分の店の店主",inc:380,eth:0,haz:0,hap:3},
 retired:{name:"引退",inc:60,eth:0,haz:0,hap:2},
};

})(globalThis.Eridu=globalThis.Eridu||{});
