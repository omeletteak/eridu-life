/*
** lab：画面の下に、SQLite の中身を見る欄を出す。
** db.js を先に読み込むこと（Eridu.db と Eridu.dbReady を使う）。
** よく使う問い合わせのボタン、SQL を打つ欄、結果の表、
** データベースをファイルに保存するボタンを置く。
*/
(() => {
  const E = window.Eridu;

  /* ボタンの名前と、押したときに欄へ入れる SQL */
  const PRESETS = [
    [
      "人",
      "SELECT p.id, g.season, p.era, p.no, p.name, p.age, p.alive, p.cause,\n" +
        "  substr(g.player, 1, 8) AS player\n" +
        "FROM people p JOIN games g ON g.id = p.game\n" +
        "ORDER BY p.id DESC LIMIT 20",
    ],
    [
      "番号",
      "SELECT season, era, no, count(*) AS walks,\n" +
        "  count(DISTINCT path) AS routes\n" +
        "FROM people GROUP BY season, era, no\n" +
        "ORDER BY walks DESC, no LIMIT 30",
    ],
    [
      "道の主",
      "SELECT p.season, p.era, p.no, p.path,\n" +
        "  substr(g.player, 1, 8) AS first_player, g.born_at, g.version\n" +
        "FROM people p JOIN games g ON g.id = p.game\n" +
        "WHERE p.game IN (\n" +
        "  SELECT min(game) FROM people GROUP BY season, era, no, path)\n" +
        "ORDER BY p.no LIMIT 30",
    ],
    [
      "選択",
      "SELECT p.name, k.age, k.key, o.label, o.t\n" +
        "FROM picks k\n" +
        "JOIN people p ON p.id = k.person\n" +
        "JOIN options o ON o.id = k.opt\n" +
        "ORDER BY k.id DESC LIMIT 30",
    ],
    [
      "記録",
      "SELECT age, text FROM log\n" +
        "WHERE person = (SELECT max(id) FROM people)\n" +
        "ORDER BY id DESC LIMIT 30",
    ],
    [
      "シーズン",
      "SELECT s.id, s.version, s.no_min, s.no_max, s.started_at,\n" +
        "  s.ended_at, count(g.id) AS walks,\n" +
        "  count(DISTINCT g.player) AS players\n" +
        "FROM seasons s LEFT JOIN games g ON g.season = s.id\n" +
        "GROUP BY s.id ORDER BY s.id",
    ],
    [
      "表の一覧",
      "SELECT name, sql FROM sqlite_master WHERE type = 'table'",
    ],
  ];


  /* 文字列 s を HTML に入れられるように置き換えて返す。 */
  const esc = s =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  /* sql.js の exec の結果 res（{columns, values} の配列）を表の HTML にして返す。 */
  function tableHTML(res){
    if( !res.length ){
      return "<p class=\"muted\">結果は0行です。</p>";
    }
    return res
      .map(r => {
        const head = r.columns.map(c => `<th>${esc(c)}</th>`).join("");
        const rows = r.values
          .map(v => {
            const cells = v
              .map(x => {
                const t = x === null ? "NULL" : esc(x);
                return `<td>${t}</td>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");
        return `<div class="sqlres"><table><tr>${head}</tr>${rows}</table></div>`;
      })
      .join("");
  }

  /* 欄を作って footer の前に置き、ボタンに動きを付ける。 */
  function mount(){
    const box = document.createElement("section");
    box.className = "card sqlbox";
    const buttons = PRESETS.map(
      (x, i) => `<button class="btn ghost" data-i="${i}">${x[0]}</button>`
    ).join("");
    box.innerHTML =
      "<div class=\"eyebrow\">lab · SQLite（in-memory）</div>" +
      "<p class=\"muted\" id=\"sqlStatus\">読み込み中…</p>" +
      `<div class="row sqlpresets">${buttons}</div>` +
      "<textarea id=\"sqlText\" rows=\"5\" spellcheck=\"false\"></textarea>" +
      "<div class=\"row\">" +
      "<button class=\"btn\" id=\"sqlRun\">実行</button>" +
      "<button class=\"btn ghost\" id=\"sqlSave\">ファイルに保存</button>" +
      "</div>" +
      "<div id=\"sqlOut\"></div>";
    document.querySelector("footer").before(box);
    const text = box.querySelector("#sqlText");
    const out = box.querySelector("#sqlOut");
    const status = box.querySelector("#sqlStatus");
    text.value = PRESETS[0][1];

    /* 欄の SQL を実行して結果を出す。書き込みのエラーがあれば先に出す。 */
    const exec = () => {
      if( !E.db ){
        return;
      }
      let html = "";
      if( E.dbErrors.length ){
        const errs = E.dbErrors.map(esc).join("<br>");
        html += `<p class="sqlerr">書き込みのエラー：<br>${errs}</p>`;
      }
      try{
        html += tableHTML(E.db.exec(text.value));
      }catch(e){
        html += `<p class="sqlerr">${esc(e.message)}</p>`;
      }
      out.innerHTML = html;
    };

    box.querySelectorAll(".sqlpresets button").forEach(btn => {
      btn.onclick = () => {
        text.value = PRESETS[+btn.dataset.i][1];
        exec();
      };
    });
    box.querySelector("#sqlRun").onclick = exec;
    /* データベースを eridu.sqlite として保存させる */
    box.querySelector("#sqlSave").onclick = () => {
      if( !E.db ){
        return;
      }
      const blob = new Blob([E.db.export()], {
        type: "application/vnd.sqlite3",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "eridu.sqlite";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    /* 用意ができるまでは生まれられない（表に入らない人を作らない） */
    const born = document.getElementById("bornBtn");
    born.disabled = true;
    E.dbReady.then(
      () => {
        born.disabled = false;
        const i = E.labInfo();
        const left = `いま ${i.left.now} · 陥落の前 ${i.left.old}`;
        status.textContent =
          `用意ができました。シーズン ${i.season}（歩かれていない番号：` +
          `${left}）。遊んだ記録はこの端末に残ります。`;
      },
      e => {
        born.disabled = false;
        const where =
          location.protocol === "file:"
            ? "file:// で開くと wasm を読み込めません。GitHub Pages で開いてください。"
            : "";
        status.textContent = "SQLite を読み込めませんでした。" + where + " " +
          e.message;
      }
    );
  }

  mount();
})();
