// 地図のピンの色分けルール。
//
// 軸（列）を選ぶと、その列の型から色分けの方式が自動で決まる。
// 「日付を選んだのにカテゴリ分けになる」といった無意味な組み合わせを
// 選べないようにするため。
//
// 保留にしている「貼替の目安期間」は、ここのしきい値として持つ。
// 固定値をコードに埋めず、画面から変えられるようにしてある。
//
// Firestore に依存しない純粋な関数だけを置く。

import { posterValue } from './table.js';
import { daysSince, lastRefreshedOn } from './stats.js';

/**
 * 使える色。デジタル庁ガイドブックの7系統に合わせている。
 * 白背景に対して WCAG AA を満たす値を選んでいる。
 */
export const PALETTE = Object.freeze({
  blue: { label: '青', hex: '#0053a3' },
  lightBlue: { label: '薄い青', hex: '#3b6fb6' },
  cyan: { label: 'シアン', hex: '#006f82' },
  green: { label: '緑', hex: '#197a4b' },
  orange: { label: '橙', hex: '#a64b00' },
  red: { label: '赤', hex: '#b7272e' },
  gray: { label: '灰', hex: '#626264' },
});

/** カテゴリに順に割り当てる色。灰は「その他・未設定」に取っておく */
const CATEGORY_COLORS = ['blue', 'orange', 'green', 'cyan', 'red', 'lightBlue'];

/** カテゴリに色を付ける上限。これを超える分は「その他」にまとめる */
const CATEGORY_LIMIT = CATEGORY_COLORS.length;

/** 「最後に手を入れた日」を表す特別な軸。貼替日が無ければ掲示日で補う */
export const REFRESHED_FIELD = '__refreshed';

/**
 * その列に使う色分けの方式を返す。
 * @param {import('./schema.js').Column} column
 * @returns {'days' | 'number' | 'check' | 'category'}
 */
export function modeForColumn(column) {
  switch (column?.type) {
    case 'date': return 'days';
    case 'number': return 'number';
    case 'check': return 'check';
    default: return 'category';
  }
}

/**
 * その列の既定の色分けルールを作る。
 * @param {import('./schema.js').Column} column
 * @returns {object}
 */
export function defaultRuleFor(column) {
  const mode = modeForColumn(column);

  const base = {
    id: 'rule-' + Date.now().toString(36),
    name: column.label + 'で色分け',
    field: column.key,
    mode,
  };

  if (mode === 'days') {
    return {
      ...base,
      // 「何日で要対応か」はここで変えられる
      buckets: [
        { upTo: 180, label: '半年以内', color: 'green' },
        { upTo: 365, label: '1年以内', color: 'cyan' },
        { upTo: 730, label: '2年以内', color: 'orange' },
        { upTo: null, label: '2年超', color: 'red' },
      ],
    };
  }

  if (mode === 'number') {
    return {
      ...base,
      buckets: [
        { upTo: 0, label: 'なし', color: 'gray' },
        { upTo: 1, label: '1枚', color: 'lightBlue' },
        { upTo: 2, label: '2枚', color: 'blue' },
        { upTo: null, label: '3枚以上', color: 'red' },
      ],
    };
  }

  if (mode === 'check') {
    return {
      ...base,
      buckets: [
        { value: true, label: 'あり', color: 'orange' },
        { value: false, label: 'なし', color: 'gray' },
      ],
    };
  }

  return { ...base, buckets: [] };
}

/**
 * その軸の値を取り出す。
 * @param {object} rule
 * @param {Record<string, *>} poster
 * @param {string} today
 * @returns {*}
 */
function valueFor(rule, poster, today) {
  if (rule.mode === 'days') {
    const dateText = rule.field === REFRESHED_FIELD
      ? lastRefreshedOn(poster)
      : poster[rule.field];
    return daysSince(dateText, today);
  }

  if (rule.field === REFRESHED_FIELD) return lastRefreshedOn(poster);

  // 固定項目とカスタム列の差を吸収する
  return posterValue(poster, { key: rule.field, system: !/^c\d+$/.test(rule.field) });
}

/**
 * そのポスターが入る区切り（色と名前）を返す。
 *
 * @param {object} rule
 * @param {Record<string, *>} poster
 * @param {string} today
 * @param {{label: string, color: string, value?: string}[]} [legend] カテゴリのときに要る
 * @returns {{label: string, color: string}}
 */
export function bucketOf(rule, poster, today, legend = null) {
  const value = valueFor(rule, poster, today);

  if (rule.mode === 'days' || rule.mode === 'number') {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return { label: '不明', color: 'gray' };
    }
    for (const bucket of rule.buckets) {
      if (bucket.upTo === null || Number(value) <= bucket.upTo) {
        return { label: bucket.label, color: bucket.color };
      }
    }
    return { label: '不明', color: 'gray' };
  }

  if (rule.mode === 'check') {
    const yes = value === true;
    const bucket = rule.buckets.find((b) => b.value === yes);
    return bucket === undefined
      ? { label: '不明', color: 'gray' }
      : { label: bucket.label, color: bucket.color };
  }

  // カテゴリ。凡例で決めた割り当てに従う
  const name = String(value ?? '').trim() || '未設定';
  const found = legend?.find((row) => row.value === name);
  return found === undefined
    ? { label: 'その他', color: 'gray' }
    : { label: found.label, color: found.color };
}

/**
 * 凡例を作る。件数が0の区切りは出さない（読みにくくなるため）。
 *
 * カテゴリは件数の多い順に色を割り当て、上限を超えた分は「その他」にまとめる。
 * 色が多すぎると、どれがどれか見分けられなくなるため。
 *
 * @param {object} rule
 * @param {Record<string, *>[]} posters
 * @param {string} today
 * @returns {{label: string, color: string, count: number, value?: string}[]}
 */
export function buildLegend(rule, posters, today) {
  if (rule.mode === 'category') {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const poster of posters) {
      const name = String(valueFor(rule, poster, today) ?? '').trim() || '未設定';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));

    const legend = sorted.slice(0, CATEGORY_LIMIT).map(([name, count], i) => ({
      value: name,
      label: name,
      color: name === '未設定' ? 'gray' : CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      count,
    }));

    const rest = sorted.slice(CATEGORY_LIMIT);
    if (rest.length > 0) {
      legend.push({
        value: null,
        label: 'その他',
        color: 'gray',
        count: rest.reduce((sum, [, count]) => sum + count, 0),
      });
    }
    return legend;
  }

  // 区切りが決まっている方式。件数を数えて0のものを落とす
  /** @type {Map<string, {label: string, color: string, count: number}>} */
  const rows = new Map();
  for (const bucket of rule.buckets) {
    rows.set(bucket.label, { label: bucket.label, color: bucket.color, count: 0 });
  }
  rows.set('不明', { label: '不明', color: 'gray', count: 0 });

  for (const poster of posters) {
    const bucket = bucketOf(rule, poster, today);
    const row = rows.get(bucket.label);
    if (row !== undefined) row.count += 1;
  }

  return [...rows.values()].filter((row) => row.count > 0);
}
