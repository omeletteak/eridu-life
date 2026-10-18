/* データ：地区・名前・仕事。ブラウザでも Node でも読める（globalThis.Eridu に載せる） */
(function(E){

/* 地区：wealth 暮らし向き / exp エーテル曝露 / crime 治安の悪さ / edu 教育環境 / dis 年間ホロウ災害率
   w = いまの時代の出生の重み / old = 旧都陥落前の出生の重み */
E.DISTRICTS=[
 {id:"rokubun",name:"六分街",desc:"下町の商店街",w:22,old:20,wealth:.5,exp:.2,crime:.3,edu:.5,dis:.006},
 {id:"center",name:"中心区",desc:"高層ビル街",w:16,old:22,wealth:.85,exp:.08,crime:.15,edu:.85,dis:.003},
 {id:"port",name:"港湾地区",desc:"倉庫と貨物線",w:15,old:18,wealth:.4,exp:.3,crime:.5,edu:.4,dis:.008},
 {id:"works",name:"再開発の工事区画",desc:"ホロウ跡地の再建現場",w:13,old:10,wealth:.35,exp:.5,crime:.4,edu:.35,dis:.012},
 {id:"outer",name:"外環",desc:"ホロウ周縁の荒野と集落",w:20,old:30,wealth:.2,exp:.75,crime:.6,edu:.25,dis:.02},
 {id:"camp",name:"避難民の仮設住宅",desc:"旧都から逃れた人々の街区",w:14,old:0,wealth:.1,exp:.55,crime:.55,edu:.15,dis:.014},
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
