/*
** 本編の data.js と sim.js を Worker の中に読み込み、globalThis.Eridu を
** そのまま返す。どちらも DOM に触らないので Worker でも動く。
** wrangler（esbuild）が1つにまとめるので、本編のファイルを写さずに使う。
** 読み込む順は data.js が先（sim.js が E.DISTRICTS などを使う）。
*/
import "../../js/data.js";
import "../../js/sim.js";

export default globalThis.Eridu;
