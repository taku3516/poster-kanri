// 一覧の並べ替え・絞り込み・値の変換のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultColumns, addCustomColumn } from '../public/js/schema.js';
import {
  posterValue,
  setPosterValue,
  formatValue,
  parseValue,
  sortPosters,
  filterPosters,
} from '../public/js/table.js';

const columns = defaultColumns();
const colOf = (label) => columns.find((c) => c.label === label);

/** 検査用のポスターを作る */
function poster(fields) {
  return { id: 'x', custom: {}, ...fields };
}

// ---------------------------------------------------------------- 値の出し入れ

test('固定項目の値は直下から読む', () => {
  const p = poster({ owner: '田中' });
  assert.equal(posterValue(p, colOf('所有者')), '田中');
});

test('カスタム列の値は custom 配下から読む', () => {
  const cols = addCustomColumn(columns, { label: '訪問回数', type: 'number' });
  const custom = cols.find((c) => c.key === 'c1');
  const p = poster({ custom: { c1: 3 } });
  assert.equal(posterValue(p, custom), 3);
});

test('値の書き込みも固定とカスタムで行き先が変わる', () => {
  const cols = addCustomColumn(columns, { label: '訪問回数', type: 'number' });
  let p = poster({});
  p = setPosterValue(p, colOf('所有者'), '鈴木');
  p = setPosterValue(p, cols.find((c) => c.key === 'c1'), 5);

  assert.equal(p.owner, '鈴木');
  assert.equal(p.custom.c1, 5);
});

test('値の書き込みは元のオブジェクトを変えない', () => {
  const p = poster({ owner: '田中' });
  const next = setPosterValue(p, colOf('所有者'), '鈴木');
  assert.equal(p.owner, '田中');
  assert.equal(next.owner, '鈴木');
});

// ---------------------------------------------------------------- 表示

test('チェックは記号で表す', () => {
  assert.equal(formatValue(true, 'check'), '✓');
  assert.equal(formatValue(false, 'check'), '');
});

test('未設定は空文字で表す（0 と混同しない）', () => {
  assert.equal(formatValue(null, 'number'), '');
  assert.equal(formatValue(undefined, 'text'), '');
  assert.equal(formatValue(0, 'number'), '0');
});

// ---------------------------------------------------------------- 入力

test('数値の入力欄が空なら 0 にする（枚数なので）', () => {
  assert.equal(parseValue('', 'number'), 0);
  assert.equal(parseValue('3', 'number'), 3);
});

test('数値にならない入力は 0 にする', () => {
  assert.equal(parseValue('あ', 'number'), 0);
});

test('日付の入力欄が空なら null にする（0 と区別するため）', () => {
  assert.equal(parseValue('', 'date'), null);
  assert.equal(parseValue('2026-08-18', 'date'), '2026-08-18');
});

test('文字は前後の空白を落とす', () => {
  assert.equal(parseValue('  品川区大井一丁目  ', 'text'), '品川区大井一丁目');
});

// ---------------------------------------------------------------- 並べ替え

const samples = [
  poster({ id: 'a', no: '3', owner: '佐藤', size3L: 2, lastReplacedOn: '2025-01-05' }),
  poster({ id: 'b', no: '1', owner: '田中', size3L: 10, lastReplacedOn: null }),
  poster({ id: 'c', no: '2', owner: '', size3L: 0, lastReplacedOn: '2024-06-01' }),
];

test('数値は文字列としてではなく数として並ぶ', () => {
  const sorted = sortPosters(samples, colOf('3連大'), 'asc');
  assert.deepEqual(sorted.map((p) => p.size3L), [0, 2, 10]);
});

test('日付は古い順に並ぶ', () => {
  const sorted = sortPosters(samples, colOf('最新貼替日'), 'asc');
  assert.deepEqual(sorted.map((p) => p.id), ['c', 'a', 'b']);
});

test('空欄は昇順でも降順でも最後に置く', () => {
  // 貼替日が未入力の行が先頭に来ると、見たい「古い順」が押し下げられる
  const asc = sortPosters(samples, colOf('最新貼替日'), 'asc');
  const desc = sortPosters(samples, colOf('最新貼替日'), 'desc');
  assert.equal(asc[asc.length - 1].id, 'b');
  assert.equal(desc[desc.length - 1].id, 'b');
});

test('降順は昇順の逆になる（空欄を除いて）', () => {
  const desc = sortPosters(samples, colOf('3連大'), 'desc');
  assert.deepEqual(desc.map((p) => p.size3L), [10, 2, 0]);
});

test('並べ替えは元の配列を変えない', () => {
  const before = samples.map((p) => p.id);
  sortPosters(samples, colOf('番号'), 'desc');
  assert.deepEqual(samples.map((p) => p.id), before);
});

// ---------------------------------------------------------------- 絞り込み

test('検索語が空なら全件返す', () => {
  assert.equal(filterPosters(samples, columns, '').length, 3);
  assert.equal(filterPosters(samples, columns, '   ').length, 3);
});

test('どの列に入っていても引っかかる', () => {
  const found = filterPosters(samples, columns, '佐藤');
  assert.deepEqual(found.map((p) => p.id), ['a']);
});

test('数値でも検索できる', () => {
  const found = filterPosters(samples, columns, '10');
  assert.deepEqual(found.map((p) => p.id), ['b']);
});

test('検索は全列への部分一致なので、日付の一部にも当たる', () => {
  // 「01」は 2024-06-01 と 2025-01-05 の両方に含まれる。
  // 絞り込みすぎるより、拾いすぎて利用者が目で選ぶ方が実用的という判断
  const found = filterPosters(samples, columns, '01');
  assert.deepEqual(found.map((p) => p.id).sort(), ['a', 'c']);
});

test('英字の大文字小文字は区別しない', () => {
  const list = [poster({ id: 'a', email: 'Taro@Example.com' })];
  assert.equal(filterPosters(list, columns, 'taro@example').length, 1);
});

test('カスタム列も検索の対象になる', () => {
  const cols = addCustomColumn(columns, { label: '回覧板担当', type: 'text' });
  const list = [poster({ id: 'a', custom: { c1: '山本' } })];
  assert.equal(filterPosters(list, cols, '山本').length, 1);
});

test('見つからなければ空を返す', () => {
  assert.equal(filterPosters(samples, columns, 'いない人').length, 0);
});
