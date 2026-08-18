// 条件での絞り込みのテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultColumns } from '../public/js/schema.js';
import {
  emptyFilters,
  isFiltered,
  applyFilters,
  describeFilters,
  nextPosterNo,
} from '../public/js/filters.js';

const TODAY = '2026-08-18';
const columns = defaultColumns();

const p = (f) => ({
  id: 'x', no: '', owner: '', district: '', status: '掲示中',
  postedOn: null, lastReplacedOn: null,
  needLadder: false, plaDan: false, indoor: false, otherParty: false,
  showOnMap: true, lat: 35.6, lng: 139.7,
  size3L: 0, size3S: 0, size2L: 0, size2S: 0, custom: {}, ...f,
});

// ---------------------------------------------------------------- 既定

test('何も指定していなければ絞り込んでいない', () => {
  assert.equal(isFiltered(emptyFilters()), false);
});

test('絞り込んでいなければ全件そのまま返す', () => {
  const list = [p({ no: '1' }), p({ no: '2' })];
  assert.equal(applyFilters(list, columns, emptyFilters(), TODAY).length, 2);
});

// ---------------------------------------------------------------- 地区・状態

test('地区で絞り込める', () => {
  const list = [p({ no: '1', district: '大井' }), p({ no: '2', district: '荏原' })];
  const found = applyFilters(list, columns, { ...emptyFilters(), district: '大井' }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['1']);
});

test('状態で絞り込める', () => {
  const list = [p({ no: '1' }), p({ no: '2', status: '交渉中' })];
  const found = applyFilters(list, columns, { ...emptyFilters(), status: '交渉中' }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['2']);
});

// ---------------------------------------------------------------- 条件（旗）

test('条件を指定すると、それに当てはまるものだけになる', () => {
  const list = [p({ no: '1', needLadder: true }), p({ no: '2' })];
  const found = applyFilters(list, columns, { ...emptyFilters(), flags: ['needLadder'] }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['1']);
});

test('条件を複数指定すると、すべてを満たすものだけになる', () => {
  // 「または」ではなく「かつ」。作業の段取りを決めるときは絞り込みたいため
  const list = [
    p({ no: '1', needLadder: true, otherParty: true }),
    p({ no: '2', needLadder: true }),
  ];
  const found = applyFilters(
    list, columns, { ...emptyFilters(), flags: ['needLadder', 'otherParty'] }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['1']);
});

// ---------------------------------------------------------------- 経過期間

test('経過日数の下限で絞り込める', () => {
  const list = [
    p({ no: '1', lastReplacedOn: '2026-08-01' }), // 17日
    p({ no: '2', lastReplacedOn: '2024-01-01' }), // 2年以上
  ];
  const found = applyFilters(list, columns, { ...emptyFilters(), minDays: 365 }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['2']);
});

test('経過日数で絞るとき、日付が無いものは残す（見落とすと困るため）', () => {
  const list = [p({ no: '1', lastReplacedOn: '2026-08-01' }), p({ no: '2' })];
  const found = applyFilters(list, columns, { ...emptyFilters(), minDays: 365 }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['2']);
});

test('貼替日が無ければ掲示日で経過を数える', () => {
  const list = [p({ no: '1', postedOn: '2020-01-01' })];
  const found = applyFilters(list, columns, { ...emptyFilters(), minDays: 365 }, TODAY);
  assert.equal(found.length, 1);
});

// ---------------------------------------------------------------- 地図に出ない

test('座標が無いものだけに絞れる', () => {
  const list = [p({ no: '1' }), p({ no: '2', lat: null, lng: null })];
  const found = applyFilters(list, columns, { ...emptyFilters(), onlyNoCoord: true }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['2']);
});

// ---------------------------------------------------------------- 文字と併用

test('文字の検索と条件は同時に効く', () => {
  const list = [
    p({ no: '1', owner: '田中', needLadder: true }),
    p({ no: '2', owner: '田中' }),
    p({ no: '3', owner: '佐藤', needLadder: true }),
  ];
  const found = applyFilters(
    list, columns, { ...emptyFilters(), text: '田中', flags: ['needLadder'] }, TODAY);
  assert.deepEqual(found.map((x) => x.no), ['1']);
});

// ---------------------------------------------------------------- 説明

test('絞り込みの内容を文章で説明できる', () => {
  const text = describeFilters({ ...emptyFilters(), district: '大井', flags: ['needLadder'] });
  assert.ok(text.includes('大井'));
  assert.ok(text.includes('要脚立'));
});

test('絞り込んでいなければ説明は空', () => {
  assert.equal(describeFilters(emptyFilters()), '');
});

// ---------------------------------------------------------------- 採番

test('次の番号は既にある最大値の次になる', () => {
  assert.equal(nextPosterNo([p({ no: '001' }), p({ no: '007' }), p({ no: '003' })]), '008');
});

test('桁数は既にある番号に合わせる', () => {
  assert.equal(nextPosterNo([p({ no: '1' })]), '2');
  assert.equal(nextPosterNo([p({ no: '0001' })]), '0002');
});

test('1件も無ければ 001 から始める', () => {
  assert.equal(nextPosterNo([]), '001');
});

test('数字でない番号は無視する（落ちない）', () => {
  assert.equal(nextPosterNo([p({ no: 'A-1' }), p({ no: '005' })]), '006');
});

test('数字が1つも無ければ 001 を返す', () => {
  assert.equal(nextPosterNo([p({ no: 'あ' })]), '001');
});
