#!/usr/bin/env node
/*
** 書き方の点検。Fossil のコーディングスタイルに寄せた決まりのうち、
** 機械で確かめられるものを調べる。
**
** 使い方:
**   node tools/style.js            js/ tools/ css/ と *.html を調べる
**   node tools/style.js a.js b.css 指定したファイルだけ調べる
**
** 調べること:
**   - タブ文字を使っていない
**   - 改行は \n だけ（\r\n を使わない）
**   - 行末に空白がない
**   - ファイルの最後が改行で終わる
**   - 1行は表示幅80桁まで（全角は2桁）
**
** 80桁の例外は、途中で切ると grep で探せなくなるもの（Fossil の
** @ 行の HTML の例外にならう）：
**   - URL を含む行
**   - 画面に出す日本語の文章（全角10字以上）を含む行
**   - HTML や SVG のタグ（<tag attr="...">）を含む行
**
** 問題があれば「ファイル:行: 内容」を出し、終了コードを 1 にする。
*/
const fs = require("fs");
const path = require("path");

/* 表示幅を2桁として数える文字（CJK・全角・絵文字など） */
const WIDE =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/* 1行の表示幅の上限 */
const MAX = 80;

/* 文字列 s の表示幅を返す（全角は2桁）。 */
function width(s){
  let w = 0;
  for(const c of s){
    w += WIDE.test(c) || c.codePointAt(0) > 0xffff ? 2 : 1;
  }
  return w;
}

/* 長い行 line が80桁の例外に当たるなら true を返す。 */
function exempt(line){
  if( /https?:\/\//.test(line) ){
    return true;
  }
  let wide = 0;
  for(const c of line){
    if( WIDE.test(c) ){
      wide++;
    }
  }
  if( wide >= 10 ){
    return true;
  }
  return /<\/?[a-zA-Z][\w-]*[ >\/]|<[a-zA-Z][\w-]* [\w-]+="/.test(line);
}

/* 調べるファイルの一覧を返す。args があればそれ、なければ既定の場所。 */
function targets(args){
  if( args.length ){
    return args;
  }
  const root = path.join(__dirname, "..");
  const files = [];
  for(const dir of ["js", "tools", "css"]){
    for(const f of fs.readdirSync(path.join(root, dir)).sort()){
      if( /\.(js|css)$/.test(f) ){
        files.push(path.join(dir, f));
      }
    }
  }
  for(const f of fs.readdirSync(root).sort()){
    if( f.endsWith(".html") ){
      files.push(f);
    }
  }
  return files.map(f => path.relative(process.cwd(), path.join(root, f)));
}

/* ファイル file を調べ、見つけた問題を「ファイル:行: 内容」の配列で返す。 */
function check(file){
  const text = fs.readFileSync(file, "utf8");
  const bad = [];
  if( text.length && !text.endsWith("\n") ){
    bad.push(`${file}: 最後が改行で終わっていない`);
  }
  text.split("\n").forEach((line, i) => {
    const at = `${file}:${i + 1}: `;
    if( line.includes("\t") ){
      bad.push(at + "タブ文字");
    }
    if( line.includes("\r") ){
      bad.push(at + "\\r\\n の改行");
    }
    if( /[ \t]+\r?$/.test(line) ){
      bad.push(at + "行末の空白");
    }
    const w = width(line.replace(/\r$/, ""));
    if( w > MAX && !exempt(line) ){
      bad.push(at + `${w}桁（${MAX}桁まで）`);
    }
  });
  return bad;
}

const problems = targets(process.argv.slice(2)).flatMap(check);
for(const p of problems){
  console.log(p);
}
if( problems.length ){
  console.log(`\n${problems.length}件`);
  process.exitCode = 1;
}else{
  console.log("問題なし");
}
