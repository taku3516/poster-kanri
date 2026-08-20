// 一覧の並べ替え・絞り込み・値の変換。
//
// 日付は Timestamp ではなく 'YYYY-MM-DD' の文字列で持つ。
// 掲示日・貼替日は時刻を持たない日付なので、Timestamp にすると
// 時差の扱いで前日にずれる。文字列なら CSV との往復でも値が変わらず、
// 辞書順がそのまま日付順になる。
//
// Firestore に依存しない純粋な関数だけを置く。

import { historyOf } from './replacements.js';

/**
 * 保存せず、読むたびに導く列。
 *
 * 導出値を保存すると、書き忘れた経路があったときに片方だけ古くなり、
 * 同じデータなのに列と列で食い違う。数えるだけの値は数える。
 *
 * @type {Record<string, (poster: Record<string, *>) => *>}
 */
const DERIVED = {
  replaceCount: (poster) => historyOf(poster).length,
};

/**
 * ポスターから、その列の値を取り出す。
 * 固定項目は直下、カスタム列は custom 配下にある差を吸収する。
 *
 * @param {Record<string, *>} poster
 * @param {import('./schema.js').Column} column
 * @returns {*}
 */
export function posterValue(poster, column) {
  const derive = DERIVED[column.key];
  if (derive !== undefined) return derive(poster ?? {});

  return column.system ? poster[column.key] : poster?.custom?.[column.key];
}

/**
 * その列の値を書き換えた、新しいポスターを返す（元は変えない）。
 *
 * @param {Record<string, *>} poster
 * @param {import('./schema.js').Column} column
 * @param {*} value
 * @returns {Record<string, *>}
 */
export function setPosterValue(poster, column, value) {
  if (column.system) {
    return { ...poster, [column.key]: value };
  }
  return { ...poster, custom: { ...(poster.custom ?? {}), [column.key]: value } };
}

/**
 * 画面に出す文字列にする。
 * 未設定は空文字にする。数値の 0 は「0」と出す（未設定と区別するため）。
 *
 * @param {*} value
 * @param {import('./schema.js').ColumnType} type
 * @returns {string}
 */
export function formatValue(value, type) {
  if (type === 'check') return value === true ? '✓' : '';
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * 入力欄の内容を、保存する値に変える。
 *
 * @param {*} raw
 * @param {import('./schema.js').ColumnType} type
 * @returns {*}
 */
export function parseValue(raw, type) {
  if (type === 'check') return raw === true || raw === 'true';

  if (type === 'number') {
    // 枚数なので、空欄は 0 として扱う
    const text = String(raw ?? '').trim();
    if (text === '') return 0;
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  if (type === 'date') {
    // 未設定は null。0 や空文字と区別できるようにする
    const text = String(raw ?? '').trim();
    return text === '' ? null : text;
  }

  return String(raw ?? '').trim();
}

/**
 * 値が「未設定」かどうか。
 * 数値の 0 とチェックの false は未設定ではない。
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isBlank(value) {
  return value === null || value === undefined || value === '';
}

/**
 * 並べ替え用の比較。未設定の扱いは呼び出し側で行う。
 *
 * @param {*} a
 * @param {*} b
 * @param {import('./schema.js').ColumnType} type
 * @returns {number}
 */
function compare(a, b, type) {
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'check') return (a === true ? 1 : 0) - (b === true ? 1 : 0);
  // 日付は 'YYYY-MM-DD' なので文字列比較で日付順になる
  return String(a).localeCompare(String(b), 'ja');
}

/**
 * 並べ替えた新しい配列を返す（元の配列は変えない）。
 *
 * 未設定の行は、昇順でも降順でも常に最後に置く。
 * 昇順で空欄が先頭に集まると、一番見たい行が押し下げられて使えないため。
 *
 * @param {Record<string, *>[]} posters
 * @param {import('./schema.js').Column} column
 * @param {'asc' | 'desc'} direction
 * @returns {Record<string, *>[]}
 */
export function sortPosters(posters, column, direction) {
  const sign = direction === 'desc' ? -1 : 1;

  return posters.slice().sort((left, right) => {
    const a = posterValue(left, column);
    const b = posterValue(right, column);

    const aBlank = isBlank(a);
    const bBlank = isBlank(b);
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;   // 向きに関わらず後ろへ
    if (bBlank) return -1;

    return compare(a, b, column.type) * sign;
  });
}

/**
 * 検索語を含む行だけに絞る。
 * 表示中かどうかに関わらず、すべての列を対象にする
 * （見えていない列に電話番号などが入っていても探せるようにするため）。
 *
 * @param {Record<string, *>[]} posters
 * @param {import('./schema.js').Column[]} columns
 * @param {string} queryText
 * @returns {Record<string, *>[]}
 */
export function filterPosters(posters, columns, queryText) {
  const needle = String(queryText ?? '').trim().toLowerCase();
  if (needle === '') return posters;

  return posters.filter((poster) =>
    columns.some((column) => {
      const value = posterValue(poster, column);
      if (isBlank(value)) return false;
      return String(value).toLowerCase().includes(needle);
    }),
  );
}
