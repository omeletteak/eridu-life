# Cloudflare Worker の試作

Cloudflare Workers の使い方を学ぶための、最小の Worker。`/hello` にだけ応答する。
本編は今までどおり GitHub Pages で配信し、この Worker とはつながっていない。

## ファイル
| ファイル | 役目 |
|---|---|
| `worker/src/index.js` | Worker 本体。`/hello` に 200、ほかは 404 |
| `worker/wrangler.toml` | wrangler の設定（名前・入口・互換性の日付） |

- Worker は ES modules（`export default`）で書く。Workers の決まりなので、本編の
  「ES modules を使わない」の例外。本編からは読まない
- ライブラリは入れない。wrangler はその場で `npx` で呼ぶ（`package.json` を置かない）

## 手元で動かす
Node.js 18 以上が要る。

```
cd worker
npx wrangler dev
```

http://localhost:8787/hello を開くと `hello from eridu-life` が返る。ほかのパスは 404。

## デプロイ
1. Cloudflare のアカウントを作る（無料のプランでよい）
2. `cd worker` して `npx wrangler login`。ブラウザが開くので許可する
3. `npx wrangler deploy`
4. 出てきた URL（`https://eridu-life-hello.<サブドメイン>.workers.dev`）の `/hello` を開いて確かめる

消すときは `npx wrangler delete`。

## まだしないこと
- GitHub Actions からの自動デプロイ（API トークンを secrets に置く必要がある）
- 独自ドメイン、KV・D1 などの保存先
