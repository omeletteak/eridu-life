/* シミュレーション：人の生成・決断・出来事・1年の進行。DOM には触らない（Node でも動く）
   data.js を先に読み込むこと */
(function(E){
const {DISTRICTS,GIVEN,FAMILY,THIREN_KIND,JOBS}=E;

/* 乱数。一括シミュレーションでは setRandom でシード付きのものに差し替えられる */
let R=Math.random;

/* ネタバレの切り替え。標準（false）では組織の名前を出さず役割だけにする。スタート画面の「ネタバレあり」で true になる
   陥落の日に組織が具体的に何をしたかは描かない（名前の切り替えだけ） */
E.spoiler=false;
const who=()=>E.spoiler
  ?{army:"防衛軍の部隊",yama:"雲嶽山の人たち"}
  :{army:"制服の部隊",yama:"山の道場の人たち"};
const armyLine=()=>who().army+"が、避難路を確保しようとしています。";
const yamaLine=p=>p.d.id==="waifei"?who().yama+"が、避難してきた人を受け入れています。":"";
E.setRandom=fn=>{R=fn};
const rnd=()=>R();

const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const pick=a=>a[Math.floor(R()*a.length)];
const wpick=(arr,w)=>{let s=arr.reduce((t,x)=>t+w(x),0),r=R()*s;for(const x of arr){r-=w(x);if(r<=0)return x}return arr[arr.length-1]};
const gauss=()=>{let u=0,v=0;while(!u)u=R();while(!v)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
/* 今の住所の医療・教育。med/edu は 0〜1
   careF：死亡率とけがの重さにかける倍率（医療が手厚いほど小さい。中心区 0.76 · 郊外 1.21） */
const careF=p=>1.3-.6*p.d.med;
const hurt=(p,n)=>{p.hp=clamp(p.hp-n*careF(p))};
const level=v=>v>=.75?"充実":v>=.5?"ふつう":v>=.3?"乏しい":"ほとんどない";
const fmt=n=>(n<0?"−":"")+Math.abs(Math.round(n)).toLocaleString("ja-JP")+"万ディニー";

/* isPeer=true の人は記録（log）を残さない。並走する4人と一括シミュレーション用 */
function newPerson(era,isPeer){
  const d=wpick(DISTRICTS.filter(x=>(era==="old"?x.old:x.w)>0),x=>era==="old"?x.old:x.w);
  const thiren=R()<.2;
  const p={
    name:pick(FAMILY)+" "+pick(GIVEN), sex:R()<.5?"女の子":"男の子",
    thiren, kind:thiren?pick(THIREN_KIND):null, d, birthD:d, era,
    age:0, alive:true, cause:null,
    hp:clamp(70+gauss()*10), hap:55, know:clamp(20+d.edu*30), rel:60, eth:0,
    money:Math.round(d.wealth*300), apt:clamp(50+gauss()*20,0,100),
    job:"none", proxy:false, married:false, kids:0, flags:{}, years:[], fallAge:era==="old"?1+Math.floor(60*Math.pow(R(),1.3)):null,
    isPeer, no:Math.floor(R()*9e5)+1e5
  };
  p.log=[];
  return p;
}

function say(p,text,cls=""){ if(p.isPeer)return; p.log.push({age:p.age,text,cls}); }

/* ===== 決断 ===== */
function decisionFor(p){
  if(!p.alive)return null;
  const f=p.flags;
  // 旧都陥落：飲まれる範囲の中にいれば避難の決断、外にいれば避難民を迎える決断
  // 一部の人は、陥落が起きた時点で自分以外の家族がすでに消息不明になっている
  if(p.fallAge!==null && p.age===p.fallAge && !f.fall){
    f.fall=1;
    if(f.forceAlone||R()<FAMILY_LOST_RATE)loseFamily(p);
    return p.d.zone==="inside"?D.fall(p):D.fallFar(p);
  }
  if(f.disaster && !f.disDone){f.disDone=1;return D.disaster(p)}
  if(p.eth>=60 && !f.ethDec){f.ethDec=1;return D.ether(p)}
  // 節目の決断は、陥落や災害と同じ年に重なったら翌年以降に持ち越す
  if(p.age>=15 && !f.d15){f.d15=1;return D.school(p)}
  if(p.age>=18 && !f.d18){f.d18=1;return D.work(p)}
  // 治安局の局員には、裏稼業の誘いはめったに来ない（来なかった年は何も起きない）
  if(p.age>=24 && !f.d24){f.d24=1;if(p.job!=="police"||R()<RARE)return D.proxy(p)}
  if(p.age>=29 && !f.d29){f.d29=1;return D.family(p)}
  if(p.age>=42 && !f.d42){f.d42=1;return D.turn(p)}
  if(p.age>=62 && !f.d62){f.d62=1;return D.retire(p)}
  return null;
}
const D={
 school:p=>({title:p.age+"歳 · 進路",text:"中学を終える年です。"+p.d.name+(p.d.edu>=.6?"には進学先がいくつもあります。":"から通える進学先は多くありません。"),opts:[
   {label:"進学校を目指して勉強する",sub:p.d.edu>=.5?"知識が伸びる。学費がかかる":"近くに塾がない。伸びは小さい",fx:p=>{p.flags.study=1;p.job="student";p.know=clamp(p.know+Math.round(6+p.d.edu*10));p.money-=40;say(p,p.d.edu>=.5?"受験勉強に打ち込んだ。":"参考書を取り寄せて、ひとりで受験勉強をした。")}},
   {label:"学校に通いながらバイトで稼ぐ",sub:"お金と人間関係",fx:p=>{p.job="student";p.money+=60;p.rel=clamp(p.rel+5);p.know=clamp(p.know+4);say(p,"放課後はラーメン屋の厨房に立った。")}},
   {label:"走り屋の仲間とつるむ",sub:"人間関係と幸福。危うい道",fx:p=>{p.flags.wild=1;p.job="student";p.rel=clamp(p.rel+10);p.hap=clamp(p.hap+8);p.know=clamp(p.know-4);say(p,"夜の郊外をバイクで走るようになった。")}},
 ]}),
 work:p=>{
   const corpChance=clamp((p.know-35)*1.6+(p.flags.study?20:0)-(p.thiren?15:0),3,90);
   return {title:p.age+"歳 · 仕事",text:"社会に出る年です。"+(p.thiren?"シリオンへの採用の壁は、まだ残っています。":"")+"エーテル適性の検査結果は「"+aptLabel(p.apt)+"」でした。",opts:[
   {label:"大手のホロウ調査企業を受ける",sub:"合格の見込み 約"+Math.round(corpChance)+"%",fx:p=>{if(R()*100<corpChance){p.job="corp";say(p,"ホロウ調査企業に採用された。","good big")}else{p.job="shop";p.hap=clamp(p.hap-8);say(p,"選考に落ちた。商店街で働きはじめる。","bad")}}},
   {label:"建設・解体の現場で働く",sub:"そこそこの収入。少しずつ侵蝕",fx:p=>{p.job="build";say(p,p.fallAge!==null&&!p.flags.fall?"建設現場で働きはじめた。":"再開発の現場で働きはじめた。")}},
   {label:"治安局に志願する",sub:p.hp>=55?"体力は足りている":"体力に不安",fx:p=>{if(p.hp>=55||R()<.4){p.job="police";say(p,"治安局の局員になった。","big")}else{p.job="build";say(p,"体力検査で落ち、現場仕事に就いた。","bad")}}},
   {label:"無許可でホロウに潜る",sub:"高収入。侵蝕と死の危険",fx:p=>{p.job="raider";say(p,"無許可のホロウレイダーになった。","eth big")}},
   ...(p.flags.wild?[{label:"ギャングの仲間と生きる",sub:"居場所はある。危険も多い",fx:p=>{p.job="gang";say(p,"ギャングの仲間と、郊外の荒野を走り回るようになった。","big")}}]:[]),
 ]}},
 proxy:p=>({title:p.age+"歳 · 誘い",text:"顔見知りから、ホロウ内の道案内をする裏稼業の手伝いを頼まれました。報酬は悪くありません。",opts:[
   {label:"断る",sub:"何も変わらない",fx:p=>say(p,"誘いを断った。")},
   {label:"引き受ける",sub:"副収入。侵蝕と治安局の目",fx:p=>{p.proxy=true;say(p,"裏でホロウの案内を請け負うようになった。","eth big")}},
 ]}),
 family:p=>{
   // 陥落で家族が消息不明になって3年以内は、気持ちの整理がつかず、長く付き合ってきた相手がいることはめったにない
   const grieving=p.flags.familyLost&&p.age-p.fallAge<=3&&R()>=RARE;
   const text=grieving?"家族の行方がわからないまま、気になる人とも距離を置いています。"
     :p.rel>=55?"長く付き合ってきた相手がいます。":"気になる人はいますが、まだ距離があります。";
   const bonus=grieving?-5:20;
   return {title:p.age+"歳 · 家族",text,opts:[
   {label:"一緒に暮らす",sub:grieving?"今は難しいかもしれない":"成功の見込みは人間関係しだい",fx:p=>{if(R()*100<p.rel+bonus){p.married=true;p.rel=clamp(p.rel+10);p.hap=clamp(p.hap+10);say(p,"結婚した。","good big");if(R()<.65){p.kids=1+(R()<.4?1:0);say(p,"子どもが生まれた。","good")}}else{p.hap=clamp(p.hap-10);say(p,"関係は終わった。","bad")}}},
   {label:"ひとりで、ボンプと暮らす",sub:"気楽。老後は少し寂しい",fx:p=>{p.hap=clamp(p.hap+3);p.flags.bangboo=1;say(p,"中古のボンプを買って、二人暮らしになった。")}},
 ]}},
 turn:p=>{
   // 陥落前はまだ中心区がない。引っ越し先は旧都の中心街（範囲の中に入るので、陥落を中で迎えることになる）
   const preFall=p.fallAge!==null&&!p.flags.fall;
   const to=DISTRICTS.find(x=>x.id===(preFall?"kcenter":"center"));
   return {title:p.age+"歳 · 転機",text:"仕事は「"+JOBS[p.job].name+"」。貯えは"+fmt(p.money)+"です。",opts:[
   {label:p.flags.lostShop?"もう一度、自分の店を開く":"自分の店を開く",sub:p.money>=300?"資金はある":"資金不足。借金になる",fx:p=>{p.money-=300;p.job="owner";p.proxy=false;say(p,p.d.name+"の路地に"+(p.flags.lostShop?"もう一度、":"")+"小さな店を開いた。","big")}},
   {label:"今の仕事を続ける",sub:"変化なし",fx:p=>say(p,"同じ毎日を続けることにした。")},
   ...(p.d.id!==to.id?[{label:to.name+"へ引っ越す",sub:"安全になる。家賃が重い",fx:p=>{p.money-=200;p.d=to;p.rel=clamp(p.rel-5);say(p,to.name+"のマンションに移った。","big")}}]:[]),
 ]}},
 retire:p=>({title:p.age+"歳 · 老後",text:"体の衰えを感じはじめています。",opts:[
   {label:"引退する",sub:"穏やかに暮らす",fx:p=>{p.job="retired";p.proxy=false;say(p,"仕事を退いた。")}},
   {label:"働き続ける",sub:"お金は入る。体には負担",fx:p=>{p.flags.oldwork=1;say(p,"まだ働くことにした。")}},
 ]}),
 /* 侵蝕の症状：ホロウに関わる仕事（か裏稼業）なら仕事を変える。そうでなければ侵蝕の元は住む地区なので引っ越す */
 ether:p=>{
   const hollowWork=["raider","police","build","corp","gang"].includes(p.job)||p.proxy;
   const working=!["none","student","retired"].includes(p.job);
   const preFall=p.fallAge!==null&&!p.flags.fall;
   const safe=DISTRICTS.find(x=>x.id===(preFall?"kcenter":"center"));
   return {title:"侵蝕の症状",text:(p.d.med>=.5?"":p.d.name+"の診療所で、")+"検査で侵蝕度が高いと言われました。皮膚に結晶のような斑点が出ています。",opts:[
   {label:"高額な治療を受ける",sub:p.d.med>=.5?"侵蝕が大きく下がる。費用 400万":"近くに専門の病院がない。遠くへ通う。費用 400万",fx:p=>{p.money-=400;p.eth=clamp(p.eth-Math.round(25+p.d.med*20));p.flags.treated=1;say(p,"侵蝕抑制の治療を受けた。","good")}},
   hollowWork
     ?{label:"仕事を変えてホロウから離れる",sub:"収入は減る",fx:p=>{if(["raider","police","build","gang"].includes(p.job))p.job="shop";p.proxy=false;p.eth=clamp(p.eth-10);say(p,"ホロウに近づかない仕事に移った。")}}
     :p.d.id!==safe.id
       ?{label:safe.name+"へ引っ越す",sub:"ホロウから遠い。家賃が重い",fx:p=>{p.money-=200;p.d=safe;p.eth=clamp(p.eth-10);say(p,"ホロウから遠い"+safe.name+"に移った。")}}
       :{label:"外出を控える",sub:"できるだけホロウに近づかない",fx:p=>{p.eth=clamp(p.eth-5);p.hap=clamp(p.hap-3);say(p,"ホロウに近い場所へは行かないようにした。")}},
   working
     ?{label:"我慢して働く",sub:"いまの暮らしを守る",fx:p=>{p.flags.ignoreEth=1;say(p,"症状を隠して働き続けた。","eth")}}
     :{label:"様子を見る",sub:"いまの暮らしを変えない",fx:p=>{p.flags.ignoreEth=1;say(p,"症状のことは、誰にも言わなかった。","eth")}},
 ]}},
 disaster:p=>({title:"共生ホロウ災害",text:p.d.name+"の一角にホロウが発生しました。避難警報が鳴っています。",opts:p.age<10?[
   {label:"大人に連れられて避難する",sub:"まだ自分では選べない",fx:p=>{if(R()<.03)die(p,"共生ホロウ災害");else{p.money-=60;p.hap=clamp(p.hap-6);say(p,"大人に抱えられて避難所に入り、数週間を過ごした。")}}},
 ]:[
   {label:"すぐに避難する",sub:"安全を優先",fx:p=>{if(R()<.03)die(p,"共生ホロウ災害");else{p.money-=60;p.hap=clamp(p.hap-6);say(p,"避難所で数週間を過ごした。")}}},
   {label:"家族や近所の人を探しに戻る",sub:"人間関係が深まる。危険",fx:p=>{p.eth=clamp(p.eth+18*(1.4-p.apt/100));if(R()<.12)die(p,"共生ホロウ災害");else{p.rel=clamp(p.rel+15);say(p,"逃げ遅れた隣人を連れ出した。","good big")}}},
 ]}),
 /* 旧都陥落（範囲の中）。alarm: 画面で警報演出を出す。年齢で選択肢が変わる
    0〜9歳：自分では選べない / 10〜13歳：子どもの選択 / 14〜39歳：おとなの選択 / 40歳〜：家族や財産をかかえた選択 */
 fall:p=>{
   if(p.flags.familyLost)return D.fallAlone(p);
   const base={title:"旧都陥落",alarm:"near",text:"かつてない規模のホロウが都市を飲み込もうとしています。街じゅうが逃げ惑っています。"+armyLine()};
   const a=p.age,tol=1.4-p.apt/100;
   const flee=(rate,line)=>p=>{if(R()<rate)die(p,"旧都陥落");else{fallSurvive(p);say(p,line,"big")}};
   const stay={label:"残って人を助ける",sub:"多くを救えるかもしれない",fx:p=>{p.eth=clamp(p.eth+30*tol);if(R()<.35)die(p,"旧都陥落");else{fallSurvive(p);p.rel=clamp(p.rel+20);p.hap=clamp(p.hap-10);say(p,"最後の避難車両で脱出した。多くの顔を覚えている。","big")}}};
   if(a<10)return {...base,text:base.text+"まだ幼いあなたに、選べることはありません。",opts:[
     {label:"親の手を握る",sub:"大人たちに任せる",fx:flee(.2,"親に手を引かれて、避難の列に並んだ。")},
   ]};
   if(a<14)return {...base,opts:[
     {label:"家族とはぐれないようにする",sub:"手を離さない",fx:flee(.17,"家族の背中だけを見て歩き、新しい都市に着いた。")},
     {label:"友だちを探しに戻る",sub:"見つけられるかもしれない。危険",fx:p=>{p.eth=clamp(p.eth+25*tol);if(R()<.32)die(p,"旧都陥落");else{fallSurvive(p);p.rel=clamp(p.rel+15);p.hap=clamp(p.hap-8);say(p,"友だちの手を引いて、最後の列に紛れ込んだ。","big")}}},
   ]};
   if(a<40)return {...base,opts:[
     {label:"避難の列に並ぶ",sub:"生き延びることだけを考える",fx:flee(.18,"すべてを置いて、新しい都市へ逃れた。")},
     stay,
   ]};
   const fam=p.married||p.kids>0;
   return {...base,opts:[
     {label:"避難の列に並ぶ",sub:"生き延びることだけを考える",fx:flee(.18,"すべてを置いて、新しい都市へ逃れた。")},
     fam?{label:"家族を先に逃がす",sub:"自分は最後になる",fx:p=>{p.eth=clamp(p.eth+20*tol);if(R()<.3)die(p,"旧都陥落");else{fallSurvive(p);p.rel=clamp(p.rel+20);say(p,"家族を先に車に乗せた。少し遅れて、同じ都市にたどり着いた。","big")}}}
        :{label:"近所の人を連れて逃げる",sub:"足の遅い人に合わせる",fx:p=>{if(R()<.25)die(p,"旧都陥落");else{fallSurvive(p);p.rel=clamp(p.rel+15);say(p,"隣の老人の荷物を背負って、一緒に歩いた。","big")}}},
     {label:p.job==="owner"?"店を守ろうとする":"家財を持ち出そうとする",sub:"財産を少しでも残せる。危険",fx:p=>{if(R()<.4)die(p,"旧都陥落");else{const kept=p.money;fallSurvive(p);p.money=Math.round(kept*.6);say(p,"持てるだけのものを抱えて逃れた。","big")}}},
   ]};
 },
};
/* 範囲の外：遠くで旧都が飲まれていくのを見ている。決断のあとは避難民が流れ込み、地元の治安と災害が少し悪くなる */
D.fallFar=p=>{
  if(p.flags.familyLost)return D.fallFarAlone(p);
  const base={title:"旧都陥落",alarm:"far",text:"旧都の方角の空に、見たことのない規模のホロウが広がっていきます。夜には、避難してきた人の列が"+p.d.name+"にも届きはじめました。"+yamaLine(p)};
  const a=p.age;
  if(a<10)return {...base,opts:[
    {label:"大人たちのそばにいる",sub:"何が起きているのかは、まだわからない",fx:p=>{fallWitness(p);say(p,"大人たちが、遠くの空を見て黙っていた。")}},
  ]};
  if(a<14)return {...base,opts:[
    {label:"炊き出しを手伝う",sub:"できることをする",fx:p=>{p.rel=clamp(p.rel+10);fallWitness(p);say(p,"避難してきた子どもたちに、汁物をよそって回った。","good big")}},
    {label:"遠くの空を見ていた",sub:"目が離せない",fx:p=>{p.hap=clamp(p.hap-3);fallWitness(p);say(p,"旧都の方角の空を、毎晩眺めていた。")}},
  ]};
  return {...base,opts:[
    {label:"受け入れて食料を分ける",sub:"人間関係が深まる。貯えが減る",fx:p=>{p.money-=80;p.rel=clamp(p.rel+15);p.hap=clamp(p.hap+3);fallWitness(p);say(p,"避難してきた家族を家に迎えた。","good big")}},
    {label:"距離を置く",sub:"いまの暮らしを守る",fx:p=>{p.hap=clamp(p.hap-3);fallWitness(p);say(p,"戸を閉めて、しばらく外に出なかった。")}},
    {label:"旧都へ人を探しに行く",sub:"侵蝕と命の危険",fx:p=>{p.eth=clamp(p.eth+20*(1.4-p.apt/100));if(R()<.08)die(p,"旧都陥落");else{fallWitness(p);p.rel=clamp(p.rel+20);p.hap=clamp(p.hap-8);say(p,"旧都の縁まで行き、はぐれた人を連れ帰った。","big")}}},
    ...(p.job==="owner"?[{label:"店を開けて炊き出しをする",sub:"貯えは大きく減る",fx:p=>{p.money-=150;p.rel=clamp(p.rel+20);p.hap=clamp(p.hap+4);fallWitness(p);say(p,"店の鍋を総動員して、避難してきた人に配った。","good big")}}]:[]),
  ]};
};
/* ===== 陥落の時点で、自分以外の家族がすでに消息不明 ===== */
const FAMILY_LOST_RATE=.15;
const RARE=.15; // 「低い確率で起きる」展開の確率（局員への裏稼業の誘い、家族を失って間もない人の長い付き合いの相手）
function loseFamily(p){
  if(p.flags.familyLost)return;
  p.flags.familyLost=1;
  p.married=false;p.kids=0;
  p.hap=clamp(p.hap-15);
  say(p,p.d.zone==="inside"?"家族の消息が途絶えた。":"家族はその日、旧都に出かけていた。連絡がつかない。","bad big");
}
/* 範囲の中・ひとり：0〜9歳は見知らぬ大人に手を引かれる一択 / 10〜13歳 / 14歳〜は家族を探すかどうか */
D.fallAlone=p=>{
  const base={title:"旧都陥落",alarm:"near",text:"かつてない規模のホロウが都市を飲み込もうとしています。家族の姿は、もうどこにもありません。"+armyLine()};
  const a=p.age,tol=1.4-p.apt/100;
  const flee=(rate,line)=>p=>{if(R()<rate)die(p,"旧都陥落");else{fallSurvive(p);say(p,line,"big")}};
  const search=(rate,eth,line)=>p=>{p.eth=clamp(p.eth+eth*tol);if(R()<rate)die(p,"旧都陥落");else{fallSurvive(p);p.hap=clamp(p.hap-10);say(p,line,"big")}};
  if(a<10)return {...base,text:base.text+"まだ幼いあなたに、選べることはありません。",opts:[
    {label:"知らない大人の手を握る",sub:"誰かが手を差し出している",fx:flee(.25,"見知らぬ大人に手を引かれて、避難の列に並んだ。")},
  ]};
  if(a<14)return {...base,opts:[
    {label:"ひとりで避難の列を探す",sub:"大人たちの流れについていく",fx:flee(.22,"大人たちの流れに紛れて、新しい都市にたどり着いた。")},
    {label:"家族を探しに家へ戻る",sub:"誰かいるかもしれない。危険",fx:search(.4,30,"家には誰もいなかった。最後の列に飛び乗った。")},
  ]};
  return {...base,opts:[
    {label:"避難の列に並ぶ",sub:"家族を信じて先に逃げる",fx:flee(.18,"家族の名前を呼びながら、避難の列に並んだ。")},
    {label:"家族を探しに残る",sub:"見つけられるかもしれない。危険",fx:search(.4,30,"心当たりを探し回ったが、誰も見つからなかった。最後の避難車両で脱出した。")},
    ...(a>=40?[{label:p.job==="owner"?"店を守ろうとする":"家財を持ち出そうとする",sub:"家族が戻る場所を残したい。危険",fx:p=>{if(R()<.4)die(p,"旧都陥落");else{const kept=p.money;fallSurvive(p);p.money=Math.round(kept*.6);say(p,"持てるだけのものを抱えて逃れた。家族の写真も入れた。","big")}}}]:[]),
  ]};
};
/* 範囲の外・ひとり：家族はその日旧都に出かけていて、連絡がつかない */
D.fallFarAlone=p=>{
  const base={title:"旧都陥落",alarm:"far",text:"旧都の方角の空に、見たことのない規模のホロウが広がっていきます。家族はその日、旧都に出かけていて、連絡がつきません。"+yamaLine(p)};
  const a=p.age,tol=1.4-p.apt/100;
  if(a<10)return {...base,opts:[
    {label:"大人たちのそばにいる",sub:"家族の帰りを待つ",fx:p=>{fallWitness(p);say(p,"家族は帰ってこなかった。近所の家に引き取られた。")}},
  ]};
  const lines={label:"避難民の列に家族を探す",sub:"毎日、名簿と顔を確かめる",fx:p=>{p.rel=clamp(p.rel+5);p.hap=clamp(p.hap-5);fallWitness(p);say(p,"毎日、避難民の列に家族の顔を探した。")}};
  if(a<14)return {...base,opts:[
    lines,
    {label:"家で帰りを待つ",sub:"灯りをつけたままにしておく",fx:p=>{p.hap=clamp(p.hap-5);fallWitness(p);say(p,"家の灯りをつけたまま、帰りを待ち続けた。")}},
  ]};
  return {...base,opts:[
    {label:"旧都へ家族を探しに行く",sub:"侵蝕と命の危険",fx:p=>{p.eth=clamp(p.eth+25*tol);if(R()<.12)die(p,"旧都陥落");else{fallWitness(p);p.hap=clamp(p.hap-10);say(p,"旧都の縁まで行ったが、家族は見つからなかった。","big")}}},
    lines,
    {label:"家で帰りを待つ",sub:"灯りをつけたままにしておく",fx:p=>{p.hap=clamp(p.hap-5);fallWitness(p);say(p,"家の灯りをつけたまま、帰りを待ち続けた。")}},
  ]};
};

function fallWitness(p){
  p.flags.witness=1;
  p.d={...p.d,crime:clamp(p.d.crime+.1,0,1),dis:p.d.dis*1.3,exp:p.d.exp+.05,med:clamp(p.d.med-.05,0,1)};
}
/* 範囲の中から生き延びた人は、仮設住宅か、避難民が寄り集まってできた六分街へ */
function fallSurvive(p){
  const to=R()<.6?"camp":"rokubun";p.d=DISTRICTS.find(x=>x.id===to);
  p.money=Math.round(p.money*.2);p.hap=clamp(p.hap-20);p.flags.survivor=1;
  // 店は旧都に残してくるので、店主ではなくなる（新しい都市では商店街で働く）
  if(p.job==="owner"){p.job="shop";p.flags.lostShop=1;say(p,"店は旧都に残してきた。","bad")}
}
function aptLabel(a){return a>=75?"高い":a>=45?"ふつう":"低い"}

/* 自動選択（同じ1秒に生まれた人たち・一括シミュレーション用） */
function autoChoose(p,dec){const o=pick(dec.opts);o.fx(p);return o}

/* ===== ランダムな出来事 ===== */
const EVENTS=[
 {p:p=>p.age>=6&&p.age<=14?.08*(p.thiren?2:1):0,fx:p=>{p.hap=clamp(p.hap-8);p.rel=clamp(p.rel-5);say(p,p.thiren?"耳としっぽのことで、クラスでからかわれた。":"学校で居場所をなくした時期があった。","bad")}},
 {p:p=>p.age>=3&&p.age<=12?.06:0,fx:p=>{p.know=clamp(p.know+6);p.hap=clamp(p.hap+4);say(p,"レンタルビデオ店に入り浸り、古い映画を片っ端から観た。")}},
 {p:p=>p.age>=8?.05:0,fx:p=>{p.rel=clamp(p.rel+6);say(p,"近所の人と親しくなった。","good")}},
 {p:p=>p.age>=16?.04:0,fx:p=>{hurt(p,12);p.money-=50;say(p,"交通事故で入院した。","bad")}},
 {p:p=>p.age>=18?.03*(.5+p.d.crime):0,fx:p=>{p.money-=Math.round(40+R()*80);p.hap=clamp(p.hap-5);say(p,"ひったくりにあった。","bad")}},
 {p:p=>p.age>=20?.03:0,fx:p=>{p.money+=150;p.hap=clamp(p.hap+5);say(p,"アーケードの大会で賞金を取った。","good")}},
 {p:p=>p.age>=30&&p.married?.04:0,fx:p=>{p.rel=clamp(p.rel-15);p.hap=clamp(p.hap-10);if(R()<.4){p.married=false;say(p,"離婚した。","bad")}else say(p,"夫婦関係がぎくしゃくした。","bad")}},
 {p:p=>p.age>=40?.05:0,fx:p=>{hurt(p,10);say(p,"健康診断で再検査になった。","bad")}},
 {p:p=>p.age>=18&&p.job==="raider"?.12:0,fx:p=>{p.money+=300;p.eth=clamp(p.eth+6);say(p,"ホロウの奥でエーテル資源を掘り当てた。","eth")}},
 {p:p=>p.proxy?.1:0,fx:p=>{if(R()<.3){p.money-=200;p.proxy=false;p.hap=clamp(p.hap-10);say(p,"治安局に目をつけられ、裏稼業から手を引いた。","bad big")}else{p.money+=120;say(p,"道案内の依頼をひとつ片付けた。")}}},
 {p:p=>p.age>=20&&p.job==="gang"?.08:0,fx:p=>{if(R()<.2)die(p,"抗争");else{hurt(p,15);say(p,"縄張り争いで大けがをした。","bad")}}},
 {p:p=>p.age>=25&&p.kids?.05:0,fx:p=>{p.hap=clamp(p.hap+8);p.rel=clamp(p.rel+5);say(p,"子どもの成長を見届けた。","good")}},
 {p:p=>p.age>=60&&!p.married&&!p.flags.bangboo?.08:0,fx:p=>{p.hap=clamp(p.hap-6);say(p,"誰とも話さない日が増えた。","bad")}},
 {p:p=>p.age>=60&&p.flags.bangboo?.06:0,fx:p=>{p.hap=clamp(p.hap+5);say(p,"ボンプの部品を取り替えた。まだ一緒にいられる。","good")}},
 {p:p=>p.age>=25?.01+.02*p.d.edu:0,fx:p=>{p.know=clamp(p.know+8);say(p,"夜間の講座に通い、資格を取った。","good")}},
 // 陥落で家族が消息不明になった人は、まれに家族の一人と再会する
 {p:p=>p.flags.familyLost&&!p.flags.reunited&&p.age>p.fallAge?.02:0,fx:p=>{p.flags.reunited=1;p.rel=clamp(p.rel+15);p.hap=clamp(p.hap+15);say(p,"避難民の名簿で、家族の一人の名前を見つけた。再会できた。","good big")}},
];

/* ===== 1年進める ===== */
function step(p){
  if(!p.alive)return;
  p.age++;
  const j=JOBS[p.job];
  // 教育の流れ
  if(p.age===6){p.job="student";say(p,"学校に通いはじめた。")}
  if(p.job==="student"){p.know=clamp(p.know+1+p.d.edu*4)}
  if(p.flags.study&&p.age===18)p.know=clamp(p.know+5);
  // 収入
  let inc=j.inc*(.7+p.know/200)*(p.thiren&&p.job==="corp"?.9:1);
  if(p.proxy)inc+=180;
  if(p.flags.oldwork&&p.age>=62)inc+=150;
  if(p.age<18)inc=0;
  const cost=p.age>=18?120+p.d.wealth*120+p.kids*40:0;
  p.money+=Math.round(inc-cost);
  // 侵蝕
  const tol=1.4-p.apt/100;
  let e=(p.d.exp*1.2+j.eth+(p.proxy?2.5:0))*tol;
  e-=(p.flags.treated?.6:0)+.3+.6*p.d.med; // 侵蝕の自然な抜けは、通える医療しだい
  p.eth=clamp(p.eth+e);
  // 状態
  const ageDecay=p.age>40?(p.age-40)*.05:0;
  p.hp=clamp(p.hp-ageDecay-(p.eth>50?(p.eth-50)*.06:0)+(p.age<30?.4:0)-(p.money<0?1:0));
  p.hap=clamp(p.hap+j.hap*.3+(p.money<0?-2:0)+(p.rel-50)*.03+(p.hp-50)*.02);
  p.rel=clamp(p.rel+(p.married?.4:-.2));
  // 出来事
  for(const ev of EVENTS){if(p.alive&&R()<ev.p(p))ev.fx(p)}
  // ホロウ災害
  if(p.alive&&!p.flags.disaster&&R()<p.d.dis){p.flags.disaster=1;say(p,p.d.name+"でホロウ災害が起きた。","bad big")}
  else if(p.flags.disDone&&R()<p.d.dis){p.flags.disaster=1;p.flags.disDone=0}
  // エーテリアス化
  if(p.alive&&p.eth>=100){die(p,"エーテリアス化");return}
  // 死亡判定
  if(p.alive){
    const base=p.age<1?.004:p.age<5?.0008:.00003*Math.exp(.095*p.age);
    // 幼い子ほど医療の差が出る（中心区 0.52 · 郊外 1.42）
    const care=p.age<5?1.6-1.2*p.d.med:careF(p);
    let q=base*(1.7-p.hp/100)*care+j.haz+(p.proxy?.003:0)+p.d.crime*.0006;
    if(p.flags.oldwork&&p.age>=62)q*=1.1;
    if(R()<q){die(p,naturalCause(p))}
  }
  p.years.push(p.alive?(p.eth>=60?"e":"l"):"x");
}
function naturalCause(p){
  const j=p.job;
  if(p.age>=78)return pick(["老衰","老衰","心不全","肺炎"]);
  if(p.age>=50)return pick(["がん","心臓病","脳卒中","がん"]);
  if(j==="raider")return pick(["ホロウ内での事故","エーテリアスの襲撃"]);
  if(j==="police")return pick(["職務中の事故","エーテリアスの襲撃"]);
  if(j==="build")return "現場での事故";
  if(j==="gang")return "抗争";
  if(p.age<5)return "感染症";
  return pick(["交通事故","病気","不慮の事故"]);
}
function die(p,cause){
  if(!p.alive)return;
  p.alive=false;p.cause=cause;
  const t=cause==="エーテリアス化"?"侵蝕が限界を超えた。治安局の記録に、身元確認済みの一件として残った。":cause+"で亡くなった。";
  say(p,t,"bad big");
}

/* 決断をランダムに選びながら最期まで流す（並走する4人の後始末と一括シミュレーション用） */
function runToEnd(p,maxYears=120,onDecision){
  let guard=0;
  while(p.alive&&guard++<maxYears){
    step(p);
    const d=decisionFor(p);
    if(d){const o=autoChoose(p,d);if(onDecision)onDecision(p,d,o)}
  }
  return p;
}

Object.assign(E,{rnd,clamp,level,pick,fmt,newPerson,say,decisionFor,D,aptLabel,autoChoose,EVENTS,step,naturalCause,die,runToEnd});

})(globalThis.Eridu=globalThis.Eridu||{});
