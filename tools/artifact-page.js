/*
** claude.ai の Artifact に出すページを作る。
** `node tools/artifact-page.js` で dist/artifact.html を書き出す。
**
** Artifact は <!doctype>・<html>・<head>・<body> を公開時に付けるので、
** eridu-life.html からそれらを外す。CSS と JS は元のファイルを Artifact の
** files として一緒に上げる（パスは css/style.css・js/*.js のまま）。
*/
const fs = require("fs"),
  path = require("path");
const root = path.join(__dirname, "..");
let s = fs.readFileSync(path.join(root, "eridu-life.html"), "utf8");
s = s
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<html[^>]*>\s*/i, "")
  .replace(/<\/html>\s*/i, "")
  .replace(/<head>\s*/i, "")
  .replace(/<\/head>\s*/i, "")
  .replace(/<body>\s*/i, "")
  .replace(/<\/body>\s*/i, "")
  /* charset と viewport は公開時に付く */
  .replace(/<meta charset[^>]*>\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "");
/* <html lang="ja"> の代わり */
s = s.replace(
  /<\/title>/i,
  '</title>\n<script>document.documentElement.lang="ja"</script>'
);
fs.mkdirSync(path.join(root, "dist"), {recursive: true});
fs.writeFileSync(path.join(root, "dist", "artifact.html"), s);
console.log("dist/artifact.html");
