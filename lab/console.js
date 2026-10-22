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
      "SELECT id, game, role, name, age, alive, cause, d, job\n" +
        "FROM people ORDER BY id DESC LIMIT 20",
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
        "WHERE person = (SELECT max(id) FROM people WHERE role = 'me')\n" +
        "ORDER BY id DESC LIMIT 30",
    ],
    [
      "型ごと",
      "SELECT k.grp, count(*) AS n\n" +
        "FROM picks x\n" +
        "JOIN options o ON o.id = x.opt\n" +
        "JOIN kinds k ON k.id = o.t\n" +
        "GROUP BY k.grp ORDER BY n DESC",
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

    E.dbReady.then(
      () => {
        status.textContent =
          "用意ができました。遊んでいる途中でも、終わったあとでも見られます。";
      },
      e => {
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
