/* シミュレーション：人の生成・決断・出来事・1年の進行。DOM には触らない（Node でも動く）
   data.js を先に読み込むこと */
(function(E){
const {DISTRICTS,GIVEN,FAMILY,THIREN_KIND,JOBS}=E;

/* 乱数。一括シミュレーションでは setRandom でシード付きのものに差し替えられる */
let R=Math.random;
E.setRandom=fn=>{R=fn};
const rnd=()=>R();

const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const pick=a=>a[Math.floor(R()*a.length)];
const wpick=(arr,w)=>{let s=arr.reduce((t,x)=>t+w(x),0),r=R()*s;for(const x of arr){r-=w(x);if(r<=0)return x}return arr[arr.length-1]};
const gauss=()=>{let u=0,v=0;while(!u)u=R();while(!v)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
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
    job:"none", proxy:false, married:false, kids:0, flags:{}, years:[], fallAge:era==="old"?14+Math.floor(R()*16):null,
    isPeer, no:Math.floor(R()*9e5)+1e5
  };
  p.log=[];
  return p;
}

function say(p,text,cls=""){ if(p.isPeer)return; p.log.push({age:p.age,text,cls}); }

/* ===== 決断 ===== */
function decisionFor(p){
  const f=p.flags;
  if(p.fallAge!==null && p.age===p.fallAge && !f.fall){f.fall=1;return D.fall(p)}
  if(f.disaster && !f.disDone){f.disDone=1;return D.disaster(p)}
  if(p.eth>=60 && !f.ethDec){f.ethDec=1;return D.ether(p)}
  if(p.age===15 && !f.d15){f.d15=1;return D.school(p)}
  if(p.age===18 && !f.d18){f.d18=1;return D.work(p)}
  if(p.age===24 && !f.d24){f.d24=1;return D.proxy(p)}
  if(p.age===29 && !f.d29){f.d29=1;return D.family(p)}
  if(p.age===42 && !f.d42){f.d42=1;return D.turn(p)}
  if(p.age===62 && !f.d62){f.d62=1;return D.retire(p)}
  return null;
}
const D={
 school:p=>({title:"15歳 · 進路",text:"中学を終える年です。"+p.d.name+"から通える進学先は多くありません。",opts:[
   {label:"進学校を目指して勉強する",sub:"知識が伸びる。学費がかかる",fx:p=>{p.flags.study=1;p.job="student";p.know=clamp(p.know+12);p.money-=40;say(p,"受験勉強に打ち込んだ。")}},
   {label:"学校に通いながらバイトで稼ぐ",sub:"お金と人間関係",fx:p=>{p.job="student";p.money+=60;p.rel=clamp(p.rel+5);p.know=clamp(p.know+4);say(p,"放課後はラーメン屋の厨房に立った。")}},
   {label:"走り屋の仲間とつるむ",sub:"人間関係と幸福。危うい道",fx:p=>{p.flags.wild=1;p.job="student";p.rel=clamp(p.rel+10);p.hap=clamp(p.hap+8);p.know=clamp(p.know-4);say(p,"夜の外環をバイクで走るようになった。")}},
 ]}),
 work:p=>{
   const corpChance=clamp((p.know-35)*1.6+(p.flags.study?20:0)-(p.thiren?15:0),3,90);
   return {title:"18歳 · 仕事",text:"社会に出る年です。"+(p.thiren?"シリオンへの採用の壁は、まだ残っています。":"")+"エーテル適性の検査結果は「"+aptLabel(p.apt)+"」でした。",opts:[
   {label:"大手のホロウ調査企業を受ける",sub:"合格の見込み 約"+Math.round(corpChance)+"%",fx:p=>{if(R()*100<corpChance){p.job="corp";say(p,"ホロウ調査企業に採用された。","good big")}else{p.job="shop";p.hap=clamp(p.hap-8);say(p,"選考に落ちた。商店街で働きはじめる。","bad")}}},
   {label:"建設・解体の現場で働く",sub:"そこそこの収入。少しずつ侵蝕",fx:p=>{p.job="build";say(p,"再開発の現場で働きはじめた。")}},
   {label:"治安局に志願する",sub:p.hp>=55?"体力は足りている":"体力に不安",fx:p=>{if(p.hp>=55||R()<.4){p.job="police";say(p,"治安局の局員になった。","big")}else{p.job="build";say(p,"体力検査で落ち、現場仕事に就いた。","bad")}}},
   {label:"無許可でホロウに潜る",sub:"高収入。侵蝕と死の危険",fx:p=>{p.job="raider";say(p,"無許可のホロウレイダーになった。","eth big")}},
   ...(p.flags.wild?[{label:"ギャングの仲間と生きる",sub:"居場所はある。危険も多い",fx:p=>{p.job="gang";say(p,"ギャングの一員として荒野で暮らしはじめた。","big")}}]:[]),
 ]}},
 proxy:p=>({title:"24歳 · 誘い",text:"顔見知りから、ホロウ内の道案内をする裏稼業の手伝いを頼まれました。報酬は悪くありません。",opts:[
   {label:"断る",sub:"何も変わらない",fx:p=>say(p,"誘いを断った。")},
   {label:"引き受ける",sub:"副収入。侵蝕と治安局の目",fx:p=>{p.proxy=true;say(p,"裏でホロウの案内を請け負うようになった。","eth big")}},
 ]}),
 family:p=>({title:"29歳 · 家族",text:p.rel>=55?"長く付き合ってきた相手がいます。":"気になる人はいますが、まだ距離があります。",opts:[
   {label:"一緒に暮らす",sub:"成功の見込みは人間関係しだい",fx:p=>{if(R()*100<p.rel+20){p.married=true;p.rel=clamp(p.rel+10);p.hap=clamp(p.hap+10);say(p,"結婚した。","good big");if(R()<.65){p.kids=1+(R()<.4?1:0);say(p,"子どもが生まれた。","good")}}else{p.hap=clamp(p.hap-10);say(p,"関係は終わった。","bad")}}},
   {label:"ひとりで、ボンプと暮らす",sub:"気楽。老後は少し寂しい",fx:p=>{p.hap=clamp(p.hap+3);p.flags.bangboo=1;say(p,"中古のボンプを買って、二人暮らしになった。")}},
 ]}),
 turn:p=>({title:"42歳 · 転機",text:"仕事は「"+JOBS[p.job].name+"」。貯えは"+fmt(p.money)+"です。",opts:[
   {label:"自分の店を開く",sub:p.money>=300?"資金はある":"資金不足。借金になる",fx:p=>{p.money-=300;p.job="owner";p.proxy=false;say(p,"六分街の路地に小さな店を開いた。","big")}},
   {label:"今の仕事を続ける",sub:"変化なし",fx:p=>say(p,"同じ毎日を続けることにした。")},
   ...(p.d.id!=="center"?[{label:"中心区へ引っ越す",sub:"安全になる。家賃が重い",fx:p=>{p.money-=200;p.d=DISTRICTS.find(x=>x.id==="center");p.rel=clamp(p.rel-5);say(p,"中心区のマンションに移った。","big")}}]:[]),
 ]}),
 retire:p=>({title:"62歳 · 老後",text:"体の衰えを感じはじめています。",opts:[
   {label:"引退する",sub:"穏やかに暮らす",fx:p=>{p.job="retired";p.proxy=false;say(p,"仕事を退いた。")}},
   {label:"働き続ける",sub:"お金は入る。体には負担",fx:p=>{p.flags.oldwork=1;say(p,"まだ働くことにした。")}},
 ]}),
 ether:p=>({title:"侵蝕の症状",text:"検査で侵蝕度が高いと言われました。皮膚に結晶のような斑点が出ています。",opts:[
   {label:"高額な治療を受ける",sub:"侵蝕が大きく下がる。費用 400万",fx:p=>{p.money-=400;p.eth=clamp(p.eth-40);p.flags.treated=1;say(p,"侵蝕抑制の治療を受けた。","good")}},
   {label:"仕事を変えてホロウから離れる",sub:"収入は減る",fx:p=>{p.job=p.job==="raider"||p.job==="police"?"shop":p.job;p.proxy=false;p.eth=clamp(p.eth-10);say(p,"ホロウに近づかない仕事に移った。")}},
   {label:"我慢して働く",sub:"いまの暮らしを守る",fx:p=>{p.flags.ignoreEth=1;say(p,"症状を隠して働き続けた。","eth")}},
 ]}),
 disaster:p=>({title:"共生ホロウ災害",text:p.d.name+"の一角にホロウが発生しました。避難警報が鳴っています。",opts:[
   {label:"すぐに避難する",sub:"安全を優先",fx:p=>{if(R()<.03)die(p,"共生ホロウ災害");else{p.money-=60;p.hap=clamp(p.hap-6);say(p,"避難所で数週間を過ごした。")}}},
   {label:"家族や近所の人を探しに戻る",sub:"人間関係が深まる。危険",fx:p=>{p.eth=clamp(p.eth+18*(1.4-p.apt/100));if(R()<.12)die(p,"共生ホロウ災害");else{p.rel=clamp(p.rel+15);say(p,"逃げ遅れた隣人を連れ出した。","good big")}}},
 ]}),
 fall:p=>({title:"旧都陥落",text:"かつてない規模のホロウが都市を飲み込もうとしています。街じゅうが逃げ惑っています。",opts:[
   {label:"避難の列に並ぶ",sub:"生き延びることだけを考える",fx:p=>{if(R()<.18)die(p,"旧都陥落");else{fallSurvive(p);say(p,"すべてを置いて、新しい都市へ逃れた。","big")}}},
   {label:"残って人を助ける",sub:"多くを救えるかもしれない",fx:p=>{p.eth=clamp(p.eth+30*(1.4-p.apt/100));if(R()<.35)die(p,"旧都陥落");else{fallSurvive(p);p.rel=clamp(p.rel+20);p.hap=clamp(p.hap-10);say(p,"最後の避難車両で脱出した。多くの顔を覚えている。","big")}}},
 ]}),
};
function fallSurvive(p){p.d=DISTRICTS.find(x=>x.id==="camp");p.money=Math.round(p.money*.2);p.hap=clamp(p.hap-20);p.flags.survivor=1}
function aptLabel(a){return a>=75?"高い":a>=45?"ふつう":"低い"}

/* 自動選択（同じ1秒に生まれた人たち・一括シミュレーション用） */
function autoChoose(p,dec){const o=pick(dec.opts);o.fx(p);return o}

/* ===== ランダムな出来事 ===== */
const EVENTS=[
 {p:p=>p.age>=6&&p.age<=14?.08*(p.thiren?2:1):0,fx:p=>{p.hap=clamp(p.hap-8);p.rel=clamp(p.rel-5);say(p,p.thiren?"耳としっぽのことで、クラスでからかわれた。":"学校で居場所をなくした時期があった。","bad")}},
 {p:p=>p.age>=3&&p.age<=12?.06:0,fx:p=>{p.know=clamp(p.know+6);p.hap=clamp(p.hap+4);say(p,"レンタルビデオ店に入り浸り、古い映画を片っ端から観た。")}},
 {p:p=>p.age>=8?.05:0,fx:p=>{p.rel=clamp(p.rel+6);say(p,"近所の人と親しくなった。","good")}},
 {p:p=>p.age>=16?.04:0,fx:p=>{p.hp=clamp(p.hp-12);p.money-=50;say(p,"交通事故で入院した。","bad")}},
 {p:p=>p.age>=18?.03*(.5+p.d.crime):0,fx:p=>{p.money-=Math.round(40+R()*80);p.hap=clamp(p.hap-5);say(p,"ひったくりにあった。","bad")}},
 {p:p=>p.age>=20?.03:0,fx:p=>{p.money+=150;p.hap=clamp(p.hap+5);say(p,"アーケードの大会で賞金を取った。","good")}},
 {p:p=>p.age>=30&&p.married?.04:0,fx:p=>{p.rel=clamp(p.rel-15);p.hap=clamp(p.hap-10);if(R()<.4){p.married=false;say(p,"離婚した。","bad")}else say(p,"夫婦関係がぎくしゃくした。","bad")}},
 {p:p=>p.age>=40?.05:0,fx:p=>{p.hp=clamp(p.hp-10);say(p,"健康診断で再検査になった。","bad")}},
 {p:p=>p.age>=18&&p.job==="raider"?.12:0,fx:p=>{p.money+=300;p.eth=clamp(p.eth+6);say(p,"ホロウの奥でエーテル資源を掘り当てた。","eth")}},
 {p:p=>p.proxy?.1:0,fx:p=>{if(R()<.3){p.money-=200;p.proxy=false;p.hap=clamp(p.hap-10);say(p,"治安局に目をつけられ、裏稼業から手を引いた。","bad big")}else{p.money+=120;say(p,"道案内の依頼をひとつ片付けた。")}}},
 {p:p=>p.age>=20&&p.job==="gang"?.08:0,fx:p=>{if(R()<.2)die(p,"抗争");else{p.hp=clamp(p.hp-15);say(p,"縄張り争いで大けがをした。","bad")}}},
 {p:p=>p.age>=25&&p.kids?.05:0,fx:p=>{p.hap=clamp(p.hap+8);p.rel=clamp(p.rel+5);say(p,"子どもの成長を見届けた。","good")}},
 {p:p=>p.age>=60&&!p.married&&!p.flags.bangboo?.08:0,fx:p=>{p.hap=clamp(p.hap-6);say(p,"誰とも話さない日が増えた。","bad")}},
 {p:p=>p.age>=60&&p.flags.bangboo?.06:0,fx:p=>{p.hap=clamp(p.hap+5);say(p,"ボンプの部品を取り替えた。まだ一緒にいられる。","good")}},
 {p:p=>p.age>=25?.02:0,fx:p=>{p.know=clamp(p.know+8);say(p,"夜間の講座に通い、資格を取った。","good")}},
];

/* ===== 1年進める ===== */
function step(p){
  if(!p.alive)return;
  p.age++;
  const j=JOBS[p.job];
  // 教育の流れ
  if(p.age===6){p.job="student";say(p,"学校に通いはじめた。")}
  if(p.job==="student"){p.know=clamp(p.know+2+p.d.edu*2)}
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
  e-=p.flags.treated?1.2:.6;
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
    let q=base*(1.7-p.hp/100)+j.haz+(p.proxy?.003:0)+p.d.crime*.0006;
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

Object.assign(E,{rnd,clamp,pick,fmt,newPerson,say,decisionFor,D,aptLabel,autoChoose,EVENTS,step,naturalCause,die,runToEnd});

})(globalThis.Eridu=globalThis.Eridu||{});
