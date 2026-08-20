// CSVの読み書き。
//
// 文字コードの方針:
//   書き出し … BOM付きUTF-8。Excelはこれで正しく開く。
//              Shift_JISでの書き出しはブラウザが対応していない
//              （TextEncoder はUTF-8のみ）ため行わない
//   読み込み … BOM付きUTF-8 / BOMなしUTF-8 / Shift_JIS を自動で見分ける。
//              読み取りは TextDecoder が対応しているので費用がかからない
//
// 列の並びは現行Excelの24列を先頭に置く。既存の表と見比べられるようにするため。
//
// Firestore に依存しない純粋な関数だけを置く。

import { orderedColumns, CSV_COLUMN_KEYS } from './schema.js';
import { posterValue } from './table.js';
import { historyOf } from './replacements.js';

/** チェックが「あり」を表す書き方。手元のExcelの揺れを吸収する */
const TRUTHY = new Set(['○', '◯', '●', '〇', '1', 'はい', 'true', '✓', '✔', 'yes', 'y', 'o']);

/**
 * チェックの値を書き出し用の文字にする。
 * @param {*} value
 * @returns {string}
 */
export function toCheckValue(value) {
  return value === true ? '○' : '';
}

/**
 * 書き方の揺れを吸収してチェックの値にする。
 * @param {*} text
 * @returns {boolean}
 */
export function fromCheckValue(text) {
  return TRUTHY.has(String(text ?? '').trim().toLowerCase());
}

/**
 * CSVを行と欄に分ける。
 *
 * 引用符の中の区切り文字・改行・二重引用符を正しく扱う。
 * 住所に「1-2,3」、備考に改行が入っていても壊れないようにするため。
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^﻿/, '');

  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }

    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }

    if (c === '\r' || c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      // CRLF は2文字で1つの改行
      i += (c === '\r' && source[i + 1] === '\n') ? 2 : 1;
      continue;
    }

    field += c; i += 1;
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // 末尾の空行を落とす
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * 書き出す列の順を返す。
 * 現行Excelの24列 → 地図と管理用 → 追加した列。
 *
 * @param {import('./schema.js').Column[]} columns
 * @returns {string[]} 見出しの並び
 */
export function csvHeader(columns) {
  return csvColumns(columns).map((c) => c.label);
}

/**
 * 書き出す列そのものを、並び順で返す。
 * @param {import('./schema.js').Column[]} columns
 * @returns {import('./schema.js').Column[]}
 */
export function csvColumns(columns) {
  const all = orderedColumns(columns, { includeHidden: true });
  const byKey = new Map(all.map((c) => [c.key, c]));

  const head = CSV_COLUMN_KEYS.map((key) => byKey.get(key)).filter((c) => c !== undefined);
  const used = new Set(CSV_COLUMN_KEYS);

  const systemRest = all.filter((c) => c.system && !used.has(c.key));
  const custom = all.filter((c) => !c.system);

  return [...head, ...systemRest, ...custom];
}

/** 貼替履歴の列の見出しに使う語。取り込みでも同じ語で見分ける */
export const HISTORY_PREFIX = '貼替';

/**
 * 貼替履歴の列の見出しを返す。
 *
 * CSVは平らな形式で入れ子を運べないため、履歴は列に開く。
 * 列の数は、書き出す行の中で最も回数の多い行に合わせる。
 * 一度も貼り替えていない台帳では1列も出さない（空列を並べても読みにくいだけ）。
 *
 * @param {Record<string, *>[]} posters
 * @returns {string[]} ['貼替1', '貼替2', …]
 */
export function historyHeaders(posters) {
  const max = (Array.isArray(posters) ? posters : [])
    .reduce((m, poster) => Math.max(m, historyOf(poster).length), 0);

  return Array.from({ length: max }, (_, i) => HISTORY_PREFIX + (i + 1));
}

/**
 * 1つの欄を書き出し用に整える。区切り文字・引用符・改行があれば引用する。
 * @param {string} text
 * @returns {string}
 */
function escapeField(text) {
  const value = String(text ?? '');
  return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}

/**
 * ポスターをCSVの文字列にする。
 *
 * @param {Record<string, *>[]} posters
 * @param {import('./schema.js').Column[]} columns
 * @returns {string}
 */
export function buildCsv(posters, columns) {
  const cols = csvColumns(columns);
  const history = historyHeaders(posters);

  const lines = [[...cols.map((c) => c.label), ...history].map(escapeField).join(',')];

  for (const poster of posters) {
    const values = cols.map((column) => {
      const value = posterValue(poster, column);
      if (column.type === 'check') return escapeField(toCheckValue(value));
      if (value === null || value === undefined) return '';
      return escapeField(String(value));
    });

    // 回数の少ない行は右側が空欄になる。列数は全行で揃える
    const dates = historyOf(poster);
    for (let i = 0; i < history.length; i += 1) values.push(escapeField(dates[i] ?? ''));

    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * 書き出し用のバイト列にする。先頭にBOMを付ける。
 * これが無いとExcelがUTF-8と見なさず文字化けする。
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
export function withBom(text) {
  const body = new TextEncoder().encode(String(text ?? ''));
  const out = new Uint8Array(body.length + 3);
  out.set([0xEF, 0xBB, 0xBF], 0);
  out.set(body, 3);
  return out;
}

/**
 * 読み込んだバイト列を文字にする。
 * BOM付きUTF-8 / BOMなしUTF-8 / Shift_JIS を見分ける。
 *
 * UTF-8として厳密に読めなければ Shift_JIS とみなす。
 * 日本の事務で扱うCSVはこの2つでほぼ尽きるため。
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeCsvBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(data.subarray(3));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('shift_jis').decode(data);
  }
}
