// 共有する内容を1枚の画像にする。
//
// 外部ライブラリ（html2canvas など）は使わない。依存パッケージを増やさない方針のため。
// ダッシュボードは棒と数字なので、Canvas に描き直せば同じことが伝わる。
//
// **地図は画像にできない。** 地図タイルは別のドメインから読んでいるため
// canvas が汚染され、toBlob が失敗する。ここでは扱わない。
//
// 描く内容は share.js が組み立てる。このファイルは並べて描くだけで、
// 何を出すか・何を出さないかの判断は持たない（氏名を出さない判断は share.js 側）。

/** 画像の幅。LINEなどで縮小されても読める大きさ */
const WIDTH = 1080;

/** 余白と行の高さ。まとめて置き、要素ごとに変えない（グリッドを崩さないため） */
const PAD = 48;
const ROW_H = 52;
/** 住所などの補足が付く行は高くする */
const ROW_H_NOTE = 78;
const SECTION_GAP = 40;

/**
 * その区分の1行の高さ。補足の有無で変わる。
 * @param {import('./share.js').ShareSection} section
 * @returns {number}
 */
function rowHeightOf(section) {
  return section.rows.some((r) => String(r.note ?? '').trim() !== '') ? ROW_H_NOTE : ROW_H;
}

/** 色は画面と揃える（デジタル庁のパレット） */
const COLOR = {
  bg: '#ffffff',
  text: '#1a1a1c',
  sub: '#626264',
  line: '#d8d8db',
  bar: '#0053a3',
  barBg: '#edeeef',
  tile: '#f5f5f6',
};

/**
 * 画像の高さを先に決める。
 * 描きながら伸ばすと、途中で足りなくなって描き直しになるため。
 *
 * @param {import('./share.js').ShareSummary} summary
 * @returns {number}
 */
export function measureHeight(summary) {
  let h = PAD + 64 + 34 + SECTION_GAP; // 表題 + 日付
  h += 150 + SECTION_GAP;              // 概要の並び

  for (const section of summary.sections) {
    h += 46;                            // 見出し
    h += section.rows.length * rowHeightOf(section);
    h += SECTION_GAP;
  }

  return h + PAD;
}

/**
 * 共有する内容を canvas に描く。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('./share.js').ShareSummary} summary
 * @returns {void}
 */
export function drawSummary(canvas, summary) {
  const height = measureHeight(summary);
  canvas.width = WIDTH;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('画像を作れませんでした（canvas を使えません）');

  const font = (size, weight) =>
    weight + ' ' + size + 'px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';

  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, WIDTH, height);

  let y = PAD;

  // --- 表題 ---
  ctx.fillStyle = COLOR.text;
  ctx.font = font(44, '700');
  ctx.textBaseline = 'top';
  ctx.fillText(summary.title, PAD, y);
  y += 64;

  ctx.fillStyle = COLOR.sub;
  ctx.font = font(24, '400');
  ctx.fillText(summary.asOf + ' 時点', PAD, y);
  y += 34 + SECTION_GAP;

  // --- 概要（大きい数字を横に並べる） ---
  const tileW = (WIDTH - PAD * 2 - 24 * (summary.headline.length - 1)) / summary.headline.length;
  summary.headline.forEach((item, i) => {
    const x = PAD + (tileW + 24) * i;
    ctx.fillStyle = COLOR.tile;
    ctx.fillRect(x, y, tileW, 150);

    ctx.fillStyle = COLOR.sub;
    ctx.font = font(24, '400');
    ctx.fillText(item.label, x + 24, y + 24);

    ctx.fillStyle = COLOR.text;
    ctx.font = font(56, '700');
    ctx.fillText(String(item.value), x + 24, y + 62);

    const w = ctx.measureText(String(item.value)).width;
    ctx.fillStyle = COLOR.sub;
    ctx.font = font(26, '400');
    ctx.fillText(item.unit, x + 24 + w + 10, y + 88);
  });
  y += 150 + SECTION_GAP;

  // --- 区分ごとの内訳 ---
  for (const section of summary.sections) {
    ctx.fillStyle = COLOR.text;
    ctx.font = font(30, '700');
    ctx.fillText(section.title, PAD, y);
    y += 40;

    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(WIDTH - PAD, y);
    ctx.stroke();
    y += 6;

    // 棒の長さは、その区分の中で最も多い行を基準にする。
    // 区分をまたいで揃えると、件数の少ない区分が潰れて読めなくなる
    const max = Math.max(1, ...section.rows.map((r) => r.value));
    const rowH = rowHeightOf(section);

    // 補足が付く区分は名前が長い（掲示場所など）ので、名前の幅を広く取る
    const labelW = rowH === ROW_H ? 220 : 430;
    const valueW = 150;
    const barX = PAD + labelW;
    const barW = WIDTH - PAD * 2 - labelW - valueW;

    for (const row of section.rows) {
      const note = String(row.note ?? '').trim();
      const cy = y + (note === '' ? rowH / 2 : 30);

      ctx.fillStyle = COLOR.text;
      ctx.font = font(26, '400');
      ctx.textBaseline = 'middle';
      ctx.fillText(clip(ctx, row.label, labelW - 16), PAD, cy);

      ctx.fillStyle = COLOR.barBg;
      ctx.fillRect(barX, cy - 12, barW, 24);

      ctx.fillStyle = COLOR.bar;
      ctx.fillRect(barX, cy - 12, (barW * row.value) / max, 24);

      ctx.fillStyle = COLOR.text;
      ctx.textAlign = 'right';
      ctx.fillText(row.value + row.unit, WIDTH - PAD, cy);
      ctx.textAlign = 'left';

      if (note !== '') {
        ctx.fillStyle = COLOR.sub;
        ctx.font = font(22, '400');
        ctx.fillText(clip(ctx, note, WIDTH - PAD * 2), PAD, cy + 28);
      }

      ctx.textBaseline = 'top';
      y += rowH;
    }

    y += SECTION_GAP;
  }
}

/**
 * 収まらない文字を切り詰める。地区名が長いと棒に重なるため。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
function clip(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + '…';
}
