/*
** 旧都陥落の演出で、画面の右下に出す出生地区のスカイライン（SVG）。
** DOM には触らず文字列を返す。
**
** 同じ人なら同じ街並みになるよう、住民番号をシードにした乱数で描く。
** シミュレーションの乱数は使わない。
*/
(function(E){
  /* SVG の座標系の幅と高さ。地面は y=H */
  const W = 600,
    H = 300;

  /*
  ** seed から決まる乱数の列を作り、次の乱数（0 以上 1 未満）を返す関数を
  ** 返す（mulberry32）。seed が 0 なら 1 として扱う。
  */
  function seeded(seed){
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 座標 v を小数1桁に丸める（SVG の文字列を短くするため）。 */
  const n = v => Math.round(v * 10) / 10;

  /*
  ** 街並みの SVG を文字列で返す。style は地区の sky（js/data.js）で、
  ** towers / shops / port / zakkyo / works / midrise / hillside / sparse /
  ** outer / camp のどれか（それ以外は camp として描く）。seed は住民番号。
  **
  ** 図形は far（遠景）・body（建物の影）・lines（線）・wins（窓の灯り）に
  ** 分けてため、最後に奥から順に重ねる。窓の灯りの一部には、順に消えて
  ** いくための class と遅れ（--d）をつける（css/style.css）。
  */
  function skylineSVG(style, seed){
    const r = seeded(seed);
    const body = [],
      lines = [],
      wins = [];
    /* 建物の影に長方形を足す。 */
    const rect = (x, y, w, h) =>
      body.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`
      );
    /* 建物の影に多角形を足す。pts は [x, y] の配列。 */
    const poly = pts =>
      body.push(
        `<polygon points="${pts.map(p => n(p[0]) + "," + n(p[1])).join(" ")}"/>`
      );
    /* 太さ w の線を足す。 */
    const line = (x1, y1, x2, y2, w = 3) =>
      lines.push(
        `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${w}"/>`
      );
    /* 太さ w の線をパス d で足す（塗りなし）。 */
    const path = (d, w = 1.5) =>
      lines.push(`<path d="${d}" fill="none" stroke-width="${w}"/>`);
    /*
    ** 窓を足す。x, y, w, h の範囲に、間隔 cw × ch で大きさ ww × wh の
    ** 窓を格子状に並べ、density の割合だけ灯す。
    */
    const winGrid = (x, y, w, h, cw, ch, ww, wh, density) => {
      for(let yy = y; yy + wh <= y + h; yy += ch){
        for(let xx = x; xx + ww <= x + w; xx += cw){
          if( r() < density ){
            wins.push([xx, yy, ww, wh]);
          }
        }
      }
    };
    /* 遠景（山並みなど）。薄い色で一番奥に描く */
    const far = [];
    /* x に高さ h の電柱を立て、電線をかける位置 [x, y] を返す。 */
    const pole = (x, h) => {
      line(x, H, x, H - h, 3);
      line(x - 10, H - h + 6, x + 10, H - h + 6, 2);
      return [x, H - h + 6];
    };
    /* 電柱の頂 tops（[x, y] の配列）の隣どうしを、たるんだ電線で結ぶ。 */
    const wires = tops => {
      for(let i = 1; i < tops.length; i++){
        const [a, b] = tops[i - 1],
          [c, d] = tops[i];
        /* 二つの頂の中ほどで、低いほうより少し下までたるませる */
        const mx = n((a + c) / 2),
          my = n(Math.max(b, d) + 14);
        path(`M${n(a)},${n(b)} Q${mx},${my} ${n(c)},${n(d)}`, 1.2);
      }
    };
    /*
    ** x に高さ h のタワークレーンを立てる。腕の長さは jib、向きは dir
    ** （-1 で左、1 で右）。
    */
    const crane = (x, h, jib, dir = -1) => {
      line(x, H, x, H - h, 5);
      for(let y = H; y > H - h + 10; y -= 14){
        line(x - 5, y, x + 5, y - 14, 1.2);
      }
      line(x + dir * jib, H - h, x - dir * jib * 0.3, H - h, 4);
      line(x, H - h - 16, x + dir * jib, H - h, 1.5);
      line(x, H - h - 16, x - dir * jib * 0.3, H - h, 1.5);
      rect(x - dir * jib * 0.3 - (dir < 0 ? 0 : 14), H - h, 14, 10);
      const hx = x + dir * jib * 0.7,
        hy = H - h + 40 + r() * 60;
      line(hx, H - h, hx, hy, 1.2);
      rect(hx - 5, hy, 10, 8);
    };

    if( style === "towers" ){
      /* 高層ビル群 */
      let x = 10;
      while( x < W ){
        const w = 36 + r() * 46,
          h = 130 + r() * 160;
        rect(x, H - h, w, h);
        if( r() < 0.35 ){
          rect(x + w * 0.15, H - h - 16, w * 0.7, 16);
        }
        if( r() < 0.4 ){
          line(
            x + w / 2,
            H - h - (r() < 0.5 ? 16 : 0),
            x + w / 2,
            H - h - 40 - r() * 40,
            3
          );
        }
        winGrid(x + 5, H - h + 10, w - 10, h - 14, 8, 11, 4, 6, 0.38);
        x += w + 3 + r() * 12;
      }
    }else if( style === "shops" ){
      /* 住宅と店舗 */
      let x = 0;
      const tops = [];
      while( x < W ){
        const w = 46 + r() * 58,
          h = 48 + r() * 78;
        rect(x, H - h, w, h);
        if( r() < 0.4 ){
          poly([
            [x - 3, H - h],
            [x + w / 2, H - h - 14 - r() * 12],
            [x + w + 3, H - h],
          ]);
        }else if( r() < 0.5 ){
          rect(x + w * 0.6, H - h - 12, w * 0.25, 12);
        }
        /* 日よけ */
        poly([
          [x + 4, H - 30],
          [x + w - 4, H - 30],
          [x + w + 2, H - 20],
          [x - 2, H - 20],
        ]);
        /* 縦の看板 */
        if( r() < 0.55 ){
          rect(x + w - 4, H - h + 8, 9, 26 + r() * 20);
        }
        winGrid(x + 7, H - h + 9, w - 14, h - 44, 13, 16, 7, 8, 0.5);
        /* 店先の灯り */
        wins.push([x + 8, H - 17, w - 16, 9]);
        if( r() < 0.45 ){
          tops.push(pole(x + w + 2, h + 20 + r() * 30));
        }
        x += w + 2 + r() * 5;
      }
      wires(tops);
    }else if( style === "port" || style === "zakkyo" ){
      /* 九龍城砦風の密集した建て増し（port は港のクレーン付き） */
      const end = style === "port" ? W * 0.66 : W;
      let x = 4,
        h = 200 + r() * 25;
      while( x < end ){
        const w = 6 + r() * 11;
        h = Math.max(175, Math.min(250, h + (r() - 0.5) * 26));
        rect(x, H - h, w + 0.6, h);
        /* 屋上の小屋や給水タンク */
        if( r() < 0.45 ){
          rect(x + r() * w * 0.5, H - h - 5 - r() * 10, 4 + r() * 7, 10);
        }
        /* アンテナ */
        if( r() < 0.45 ){
          line(x + w / 2, H - h, x + w / 2, H - h - 10 - r() * 22, 1.4);
        }
        /* 張り出し */
        if( r() < 0.2 ){
          rect(x - 3, H - h + 20 + r() * 60, w + 6, 5);
        }
        winGrid(x + 2, H - h + 6, w - 3, h - 10, 5, 7, 2.6, 3.2, 0.42);
        x += w;
      }
      if( style === "port" ){
        /* 倉庫 */
        rect(end + 6, H - 48, W - end - 6, 48);
        winGrid(end + 12, H - 40, W - end - 20, 30, 14, 12, 6, 4, 0.3);
        /* ガントリークレーン（港の側へ腕を伸ばす） */
        const cx = end + 92;
        line(cx, H - 48, cx, H - 200, 5);
        line(cx + 40, H - 48, cx + 40, H - 200, 5);
        line(cx, H - 130, cx + 40, H - 130, 3);
        line(cx - 60, H - 200, W - 4, H - 200, 6);
        line(cx + 20, H - 232, cx - 60, H - 200, 1.5);
        line(cx + 20, H - 232, W - 4, H - 200, 1.5);
        line(cx + 20, H - 232, cx + 20, H - 200, 3);
        line(cx - 30, H - 200, cx - 30, H - 110, 1.2);
        rect(cx - 37, H - 110, 14, 9);
      }
    }else if( style === "works" ){
      /* 骨組みだけのビルとタワークレーン */
      let x = 10;
      while( x < W ){
        const w = 50 + r() * 60,
          h = 70 + r() * 150;
        if( r() < 0.45 ){
          /* 完成した低い建物 */
          const hh = h * 0.5;
          rect(x, H - hh, w, hh);
          winGrid(x + 6, H - hh + 8, w - 12, hh - 12, 12, 14, 6, 7, 0.35);
        }else{
          /* 骨組み */
          const floors = Math.max(3, Math.round(h / 22)),
            cols = Math.max(2, Math.round(w / 22));
          for(let i = 0; i <= cols; i++){
            line(x + (i * w) / cols, H, x + (i * w) / cols, H - h, 2.5);
          }
          for(let j = 0; j <= floors; j++){
            line(
              x,
              H - (j * h) / floors,
              x + w,
              H - (j * h) / floors,
              j === floors ? 3 : 1.8
            );
          }
          rect(x, H - h * 0.35, w, h * 0.35);
          winGrid(x + 6, H - h * 0.35 + 8, w - 12, h * 0.35 - 12,
                  12, 14, 6, 7, 0.3);
        }
        x += w + 8 + r() * 20;
      }
      crane(W * 0.32, 250, 120, -1);
      crane(W * 0.78, 215, 100, 1);
    }else if( style === "midrise" ){
      /* 中層のビルと店舗が混ざる市街地 */
      let x = 0;
      while( x < W ){
        if( r() < 0.5 ){
          const w = 34 + r() * 36,
            h = 95 + r() * 90;
          rect(x, H - h, w, h);
          if( r() < 0.35 ){
            rect(x + w * 0.2, H - h - 12, w * 0.6, 12);
          }
          if( r() < 0.3 ){
            line(x + w * 0.7, H - h, x + w * 0.7, H - h - 26 - r() * 20, 2.5);
          }
          winGrid(x + 5, H - h + 9, w - 10, h - 14, 8, 12, 4, 6, 0.42);
          x += w + 2 + r() * 6;
        }else{
          const w = 40 + r() * 40,
            h = 48 + r() * 45;
          rect(x, H - h, w, h);
          poly([
            [x + 3, H - 28],
            [x + w - 3, H - 28],
            [x + w + 2, H - 19],
            [x - 2, H - 19],
          ]);
          if( r() < 0.6 ){
            rect(x + w - 5, H - h + 6, 9, 22 + r() * 16);
          }
          winGrid(x + 7, H - h + 8, w - 14, h - 40, 12, 15, 6, 7, 0.5);
          wins.push([x + 7, H - 16, w - 14, 8]);
          x += w + 1 + r() * 4;
        }
      }
    }else if( style === "hillside" ){
      /*
      ** 海に面した坂の古い町並み（九份風）：斜面に段々に積む家、
      ** 提灯の灯る石段、手前の海
      */
      /* x での地面の高さ。左の海辺から右へ上っていく斜面 */
      const ground = x =>
        H - 12 - Math.pow(Math.max(0, x - 70) / (W - 70), 1.2) * 175;
      /* 背後の山 */
      far.push(
        `<path d="M0,${H - 30} Q220,${H - 120} 400,${H - 235} T600,${H - 285} L600,${H} L0,${H}Z"/>`
      );
      /* x, y から幅 w の家の上に、反り返った軒を足す。 */
      const eave = (x, y, w) =>
        poly([
          [x - 6, y + 2],
          [x + w * 0.2, y - 7],
          [x + w * 0.8, y - 7],
          [x + w + 6, y + 2],
        ]);
      /* 地面の高さ base に、幅 w・高さ h の家を建てる（下は画面の底まで）。 */
      const house = (x, base, w, h) => {
        rect(x, base - h, w, H - base + h);
        eave(x, base - h, w);
        winGrid(x + 5, base - h + 7, w - 10, h - 10, 10, 12, 5, 6, 0.5);
      };
      /* 奥の段から手前の段へ。奥ほど高い位置に建つ */
      for(const back of [58, 30, 0]){
        let x = 80 + r() * 10;
        while( x < W ){
          const w = 24 + r() * 26,
            h = 20 + r() * 22;
          house(x, ground(x + w / 2) - back + 4, w, h);
          /* 軒先の提灯 */
          if( back === 0 && r() < 0.3 ){
            wins.push([x + w / 2 - 2, ground(x + w / 2) - h + 1, 4, 6]);
          }
          x += w + 2 + r() * 8;
        }
      }
      /* 石段：斜面を縫って上る道に、提灯を連ねる */
      const sx = W * (0.45 + r() * 0.15);
      let px = sx,
        py = H;
      for(let i = 0; i < 9; i++){
        const nx = px + (i % 2 ? 14 : -10) + r() * 6,
          ny = py - 24;
        path(`M${n(px)},${n(py)} L${n(nx)},${n(ny)}`, 1.4);
        for(let t = 0.25; t < 1; t += 0.5){
          wins.push([px + (nx - px) * t - 2, py + (ny - py) * t - 6, 4, 5]);
        }
        px = nx;
        py = ny;
      }
      /* 海：左端の波 */
      for(let i = 0; i < 3; i++){
        const y = H - 4 - i * 6,
          x2 = 80 - i * 18;
        path(`M0,${y} Q${n(x2 / 2)},${y - 3} ${n(x2)},${y}`, 1);
      }
    }else if( style === "sparse" ){
      /* 広い土地に施設が点在：低く横に長い建物、ドーム、細い塔 */
      /* 目印になる塔とドームを必ず1つずつ置く */
      const tx = W * (0.62 + r() * 0.25),
        th = 200 + r() * 60;
      rect(tx + 6, H - th, 8, th);
      rect(tx, H - th + 22, 20, 14);
      line(tx + 10, H - th, tx + 10, H - th - 30, 2);
      wins.push([tx + 3, H - th + 26, 14, 5]);
      const dx = W * (0.3 + r() * 0.15),
        dr = 55 + r() * 20;
      body.push(
        `<path d="M${n(dx - dr)},${H} A${n(dr)},${n(dr * 0.8)} 0 0 1 ${n(dx + dr)},${H}Z"/>`
      );
      winGrid(dx - dr * 0.5, H - 16, dr, 8, 10, 10, 5, 4, 0.6);
      let x = 0;
      while( x < W ){
        const k = r();
        if( k < 0.18 ){
          /* ドーム */
          const rw = 40 + r() * 30;
          body.push(
            `<path d="M${n(x)},${H} A${n(rw)},${n(rw * 0.8)} 0 0 1 ${n(x + rw * 2)},${H}Z"/>`
          );
          winGrid(x + rw * 0.6, H - 14, rw * 0.8, 8, 10, 10, 5, 4, 0.6);
          x += rw * 2 + 20 + r() * 40;
        }else if( k < 0.3 ){
          /* 細い塔 */
          const h = 150 + r() * 80;
          rect(x + 6, H - h, 8, h);
          rect(x, H - h + 18, 20, 12);
          line(x + 10, H - h, x + 10, H - h - 24, 2);
          wins.push([x + 3, H - h + 21, 14, 5]);
          x += 24 + r() * 40;
        }else{
          /* 低く横に長い施設 */
          const w = 70 + r() * 90,
            h = 22 + r() * 34;
          rect(x, H - h, w, h);
          if( r() < 0.4 ){
            rect(x + w * 0.1, H - h - 10, w * 0.25, 10);
          }
          winGrid(x + 8, H - h + 7, w - 16, h - 12, 14, 12, 8, 5, 0.35);
          x += w + 25 + r() * 55;
        }
      }
    }else if( style === "outer" ){
      /* バラックの貧民窟 */
      let x = 0;
      const tops = [];
      while( x < W ){
        const w = 16 + r() * 22;
        let h = 22 + r() * 40,
          top = H - h;
        rect(x, top, w, h);
        winGrid(x + 3, top + 5, w - 6, h - 9, 8, 10, 3.5, 4, 0.25);
        /* 上に建て増しを1〜3段、少しずらしながら積む */
        const levels = r() < 0.65 ? 1 + Math.floor(r() * 3) : 0;
        for(let i = 0; i < levels; i++){
          const w2 = w * (0.55 + r() * 0.5),
            h2 = 12 + r() * 18,
            x2 = x + (r() - 0.3) * w * 0.5;
          rect(x2, top - h2, w2, h2 + 1);
          winGrid(x2 + 3, top - h2 + 4, w2 - 6, h2 - 7, 8, 9, 3.5, 4, 0.25);
          /* 張り出した物干しや板 */
          if( r() < 0.3 ){
            rect(x2 + w2 - 2, top - h2 + 4, 8, 3);
          }
          top -= h2;
        }
        const lean = r() < 0.5 ? -1 : 1;
        poly([
          [x - 2, top],
          [x + w + 2, top + 2],
          [x + w / 2 + lean * w * 0.3, top - 5 - r() * 7],
        ]);
        if( r() < 0.3 ){
          line(x + w * 0.3, top, x + w * 0.3, top - 10 - r() * 14, 1.3);
        }
        if( r() < 0.14 ){
          tops.push(pole(x + w / 2, Math.max(110, H - top + 30)));
        }
        x += w - (r() < 0.4 ? 4 : 0) + (r() < 0.12 ? 4 + r() * 8 : 0);
      }
      /* 給水塔 */
      const tx = W * 0.55;
      line(tx, H, tx + 6, H - 120, 3);
      line(tx + 40, H, tx + 34, H - 120, 3);
      line(tx, H - 60, tx + 40, H - 100, 1.5);
      line(tx + 40, H - 60, tx, H - 100, 1.5);
      rect(tx - 4, H - 150, 48, 32);
      poly([
        [tx - 6, H - 150],
        [tx + 46, H - 150],
        [tx + 20, H - 166],
      ]);
      wires(tops);
    }else{
      /* camp：積み重なったプレハブとテント */
      let x = 6;
      while( x < W ){
        const w = 38 + r() * 18,
          levels = 2 + Math.floor(r() * 3);
        for(let i = 0; i < levels; i++){
          const y = H - (i + 1) * 24,
            dx = (i % 2) * 5;
          rect(x + dx, y, w, 22.5);
          winGrid(x + dx + 6, y + 7, w - 12, 10, 12, 10, 6, 5, 0.45);
        }
        /* 外階段 */
        line(x + w + 2, H, x + w + 2, H - levels * 24, 1.5);
        for(let i = 1; i < levels; i++){
          line(x + w - 6, H - i * 24 + 2, x + w + 8, H - i * 24 - 10, 1.5);
        }
        if( r() < 0.35 ){
          const tw = 24 + r() * 14;
          poly([
            [x + w + 8, H],
            [x + w + 8 + tw / 2, H - 22 - r() * 8],
            [x + w + 8 + tw, H],
          ]);
          x += tw + 6;
        }
        x += w + 5 + r() * 4;
      }
    }

    /* 窓の灯りは、あとで一部が順に消えていく（避難が進むようす） */
    const winSvg = wins
      .map(([x, y, w, h]) => {
        const out = r() < 0.7;
        const cls = out ? "w out" : "w";
        const delay = out ? ` style="--d:${n(2 + r() * 12)}s"` : "";
        return `<rect class="${cls}" x="${n(x)}" y="${n(y)}"` +
          ` width="${n(w)}" height="${n(h)}"${delay}/>`;
      })
      .join("");
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
<defs><linearGradient id="skyFade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".28" stop-color="#fff" stop-opacity="1"/></linearGradient>
<mask id="skyMask"><rect width="${W}" height="${H}" fill="url(#skyFade)"/></mask></defs>
<g mask="url(#skyMask)"><g class="sil far">${far.join("")}</g><g class="sil">${body.join("")}</g><g class="ln">${lines.join("")}</g><g>${winSvg}</g></g></svg>`;
  }

  E.skylineSVG = skylineSVG;
})(globalThis.Eridu = globalThis.Eridu || {});
