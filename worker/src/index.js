/*
** lab の道を共有する Cloudflare Worker（docs/worker.md）。
**
** 本編（eridu-life.html）は GitHub Pages で配信していて、この Worker とは
** つながっていない。lab をつなぐのはこれから。
**
** 応答:
**   GET /hello  200 で "hello from eridu-life" を返す（text/plain）
**   /api/…      道の共有の API（src/api.js）。D1 の DB を使う
**   それ以外    404 で "not found" を返す
*/
import {handle} from "./api.js";

/* 本文 body と状態 status から、プレーンテキストの応答を作って返す。 */
function text(body, status){
  return new Response(body + "\n", {
    status: status,
    headers: {"content-type": "text/plain; charset=utf-8"}
  });
}

export default {
  /*
  ** Workers が要求ごとに呼ぶ入口。request の URL のパスを見て、
  ** /hello なら挨拶を、/api/ なら API の応答を、それ以外なら 404 を返す。
  ** env.DB は wrangler.toml でつないだ D1。ctx は使わない。
  */
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    if( url.pathname === "/hello" ){
      return text("hello from eridu-life", 200);
    }
    if( url.pathname.startsWith("/api/") ){
      return handle(request, url, env);
    }
    return text("not found", 404);
  }
};
