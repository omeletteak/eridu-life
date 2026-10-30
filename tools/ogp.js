#!/usr/bin/env node
/*
** OGP 画像（リンクを貼ったときに出る絵）を作る。tools/ogp.html を
** 1200×630 で開いて撮り、img/ogp.png に書き出す。
**
** 使い方:
**   node tools/ogp.js
**
** Playwright と Chromium が要る（require("playwright") が通ること）。
** ogp.html は Google Fonts を読むので、ネットにつながっていること。
** 絵を変えたら、eridu-life.html と index.html の og:image を見直す
** （SNS は絵を覚えるので、変えたら ?v=2 のように URL を変えると早く替わる）。
*/
const path = require("path");
const {chromium} = require("playwright");

/* ogp.html を撮って img/ogp.png に書き出す。終わったら閉じる。 */
async function main(){
  const root = path.join(__dirname, "..");
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({
      viewport: {width: 1200, height: 630},
    });
    await page.goto("file://" + path.join(__dirname, "ogp.html"));
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(root, "img", "ogp.png");
    await page.screenshot({path: out});
    console.log("書き出した: " + path.relative(process.cwd(), out));
  }finally{
    await browser.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
