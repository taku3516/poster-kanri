// 一覧と地図の絞り込み。
//
// 絞り込みは一覧と地図で共有する。片方で絞った結果がもう片方にも効くことで、
// 「脚立が要る場所だけ地図に出して回る順を決める」といった使い方ができる。
//
// Firestore に依存しない純粋な関数だけを置く。

import { filterPosters } from './table.js';
import { daysSince, lastRefreshedOn } from './stats.js';

/**
 * 絞り込みに使える「条件」。値が true のものだけを残す。
 * @type {readonly {key: string, label: string}[]}
 */
export const FLAG_OPTIONS = Object.freeze([
  { key: 'needLadder', label: '要脚立' },
  { key: 'plaDan', label: 'プラ段' },
  { key: 'indoor', label: '室内' },
  { key: 'otherParty', label: '他党あり' },
]);

/** 経過期間の選択肢 */
export const DAYS_OPTIONS = Object.freeze([
  { value: null, label: 'すべて' },
  { value: 180, label: '半年以上' },
  { value: 365, label: '1年以上' },
  { value: 730, label: '2年以上' },
]);

/**
 * @typedef {object} Filters
 * @property {string} text        文字の検索
 * @property {string} district    地区（空はすべて）
 * @property {string} status      状態（空はすべて）
 * @property {string} introducer  紹介者（空はすべて）
 * @property {string[]} flags     すべて満たす条件
 * @property {number|null} minDays 経過日数の下限
 * @property {boolean} onlyNoCoord 座標が無いものだけ
 */

/**
 * 何も絞っていない状態。
 * @returns {Filters}
 */
export function emptyFilters() {
  return {
    text: '', district: '', status: '', introducer: '',
    flags: [], minDays: null, onlyNoCoord: false,
  };
}

/**
 * 何かしら絞り込んでいるか。
 * @param {Filters} filters
 * @returns {boolean}
 */
export function isFiltered(filters) {
  return String(filters.text ?? '').trim() !== ''
    || filters.district !== ''
    || filters.status !== ''
    || (filters.introducer ?? '') !== ''
    || (filters.flags ?? []).length > 0
    || filters.minDays !== null
    || filters.onlyNoCoord === true;
}

/**
 * 絞り込みを適用する。
 *
 * @param {Record<string, *>[]} posters
 * @param {import('./schema.js').Column[]} columns
 * @param {Filters} filters
 * @param {string} today
 * @returns {Record<string, *>[]}
 */
export function applyFilters(posters, columns, filters, today) {
  let rows = filterPosters(posters, columns, filters.text ?? '');

  if (filters.district !== '') {
    rows = rows.filter((p) => String(p.district ?? '') === filters.district);
  }

  if (filters.status !== '') {
    rows = rows.filter((p) => String(p.status ?? '') === filters.status);
  }

  // 文字の検索だと所有者が同姓の行まで拾うため、紹介者だけを見る
  if ((filters.introducer ?? '') !== '') {
    rows = rows.filter((p) => String(p.introducer ?? '') === filters.introducer);
  }

  for (const flag of filters.flags ?? []) {
    rows = rows.filter((p) => p[flag] === true);
  }

  if (filters.minDays !== null) {
    rows = rows.filter((p) => {
      const days = daysSince(lastRefreshedOn(p), today);
      // 日付が無いものは残す。経過が長い側を探しているとき、
      // 「いつ貼ったか分からない」場所を落とすと見落としになる
      return days === null || days >= filters.minDays;
    });
  }

  if (filters.onlyNoCoord === true) {
    rows = rows.filter((p) => typeof p.lat !== 'number' || typeof p.lng !== 'number');
  }

  return rows;
}

/**
 * いま何で絞っているかを文章にする。
 * 絞り込みに気づかないまま「件数が合わない」と悩むのを防ぐため。
 *
 * @param {Filters} filters
 * @returns {string}
 */
export function describeFilters(filters) {
  const parts = [];

  const text = String(filters.text ?? '').trim();
  if (text !== '') parts.push('「' + text + '」を含む');
  if (filters.district !== '') parts.push('地区: ' + filters.district);
  if (filters.status !== '') parts.push('状態: ' + filters.status);
  if ((filters.introducer ?? '') !== '') parts.push('紹介者: ' + filters.introducer);

  for (const flag of filters.flags ?? []) {
    const found = FLAG_OPTIONS.find((o) => o.key === flag);
    if (found !== undefined) parts.push(found.label);
  }

  if (filters.minDays !== null) {
    const found = DAYS_OPTIONS.find((o) => o.value === filters.minDays);
    parts.push(found === undefined ? filters.minDays + '日以上' : found.label);
  }

  if (filters.onlyNoCoord === true) parts.push('座標なし');

  return parts.join(' / ');
}

/**
 * 次に使う番号を返す。
 *
 * 既にある番号のうち数字として読めるものの最大値の次を使い、
 * 桁数は既存の書き方に合わせる（001 なら 002、1 なら 2）。
 *
 * @param {Record<string, *>[]} posters
 * @returns {string}
 */
export function nextPosterNo(posters) {
  let max = 0;
  let width = 3; // 1件も無いときは 001 から
  let found = false;

  for (const poster of posters) {
    const text = String(poster?.no ?? '').trim();
    if (!/^\d+$/.test(text)) continue;

    found = true;
    const value = Number(text);
    if (value >= max) {
      max = value;
      width = text.length;
    }
  }

  const next = max + 1;
  return found ? String(next).padStart(width, '0') : '001';
}
