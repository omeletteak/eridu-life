/*
** 試作の最小の Cloudflare Worker。/hello にだけ応答する。
**
** 本編（eridu-life.html）は GitHub Pages で配信していて、この Worker とは
** つながっていない。Workers の使い方を試すための置き場（docs/worker.md）。
**
** 応答:
**   GET /hello  200 で "hello from eridu-life" を返す（text/plain）
**   それ以外    404 で "not found" を返す
*/

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
  ** /hello なら挨拶を、それ以外なら 404 を返す。env と ctx は使わない。
  */
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    if( url.pathname === "/hello" ){
      return text("hello from eridu-life", 200);
    }
    return text("not found", 404);
  }
};
