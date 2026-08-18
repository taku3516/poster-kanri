// ダッシュボードの集計のテスト。
// 「今日」を引数で渡すことで、いつ実行しても同じ結果になるようにしている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastRefreshedOn,
  daysSince,
  summarize,
  byDistrict,
  stalest,
} from '../public/js/stats.js';

const TODAY = '2026-08-18';

/** @param {object} f */
const p = (f) => ({
  no: '', postedOn: null, lastReplacedOn: null, district: '',
  size3L: 0, size3S: 0, size2L: 0, size2S: 0,
  needLadder: false, plaDan: false, indoor: false, otherParty: false,
  showOnMap: true, lat: null, lng: null, status: '掲示中', custom: {}, ...f,
});

// ---------------------------------------------------------------- 経過日数

test('貼替日があればそれを使う', () => {
  assert.equal(lastRefreshedOn(p({ postedOn: '2022-01-01', lastReplacedOn: '2025-05-05' })), '2025-05-05');
});

test('貼替日が無ければ掲示日を使う', () => {
  // 一度も貼り替えていない場合、経過は「貼った日から」で数えるのが正しい
  assert.equal(lastRefreshedOn(p({ postedOn: '2022-01-01', lastReplacedOn: null })), '2022-01-01');
});

test('どちらも無ければ null', () => {
  assert.equal(lastRefreshedOn(p({})), null);
});

test('経過日数を数える', () => {
  assert.equal(daysSince('2026-08-18', TODAY), 0);
  assert.equal(daysSince('2026-08-11', TODAY), 7);
  assert.equal(daysSince('2025-08-18', TODAY), 365);
});

test('日付が無ければ経過日数は null', () => {
  assert.equal(daysSince(null, TODAY), null);
  assert.equal(daysSince('', TODAY), null);
});

// ---------------------------------------------------------------- 全体集計

test('件数と総枚数を数える', () => {
  const list = [
    p({ size3L: 2, size2S: 1 }),
    p({ size3S: 3 }),
  ];
  const s = summarize(list, TODAY);
  assert.equal(s.total, 2);
  assert.equal(s.sheets, 6);
});

test('種別ごとの枚数を分けて数える', () => {
  const s = summarize([p({ size3L: 2, size3S: 1 }), p({ size3L: 1 })], TODAY);
  assert.deepEqual(s.byType, { size3L: 3, size3S: 1, size2L: 0, size2S: 0 });
});

test('条件つきの件数を数える', () => {
  const s = summarize([
    p({ needLadder: true, otherParty: true }),
    p({ needLadder: true }),
    p({ indoor: true }),
  ], TODAY);
  assert.equal(s.needLadder, 2);
  assert.equal(s.otherParty, 1);
  assert.equal(s.indoor, 1);
});

test('地図に出ていない件数を、理由ごとに分けて数える', () => {
  // 「座標が無い」と「掲載を外している」は対処が違うので混ぜない
  const s = summarize([
    p({ lat: 35.6, lng: 139.7 }),
    p({ lat: null }),
    p({ lat: 35.6, lng: 139.7, showOnMap: false }),
  ], TODAY);
  assert.equal(s.onMap, 1);
  assert.equal(s.noCoord, 1);
  assert.equal(s.hiddenOnMap, 1);
});

test('撤去済は集計から外す（今ある掲示場所を数えたいため）', () => {
  const s = summarize([
    p({ size3L: 1 }),
    p({ size3L: 5, status: '撤去済' }),
  ], TODAY);
  assert.equal(s.total, 1);
  assert.equal(s.sheets, 1);
  assert.equal(s.removed, 1);
});

// ---------------------------------------------------------------- 地区別

test('地区ごとに件数と枚数を出し、多い順に並べる', () => {
  const list = [
    p({ district: '大井', size3L: 1 }),
    p({ district: '大井', size2L: 2 }),
    p({ district: '荏原', size3S: 1 }),
  ];
  const rows = byDistrict(list);
  assert.deepEqual(rows[0], { district: '大井', count: 2, sheets: 3 });
  assert.deepEqual(rows[1], { district: '荏原', count: 1, sheets: 1 });
});

test('地区が空のものは「未設定」としてまとめる', () => {
  const rows = byDistrict([p({ district: '' })]);
  assert.equal(rows[0].district, '未設定');
});

// ---------------------------------------------------------------- 貼替が古い順

test('貼替が古い順に並べ、経過日数を添える', () => {
  const list = [
    p({ no: 'A', lastReplacedOn: '2026-01-01' }),
    p({ no: 'B', lastReplacedOn: '2024-01-01' }),
    p({ no: 'C', lastReplacedOn: '2025-01-01' }),
  ];
  const rows = stalest(list, TODAY, 10);
  assert.deepEqual(rows.map((r) => r.poster.no), ['B', 'C', 'A']);
  assert.equal(rows[0].days, daysSince('2024-01-01', TODAY));
});

test('日付が全く無いものは最上位に置く（状況が分からないのが最も危ういため）', () => {
  const list = [
    p({ no: 'A', lastReplacedOn: '2024-01-01' }),
    p({ no: 'B' }),
  ];
  const rows = stalest(list, TODAY, 10);
  assert.equal(rows[0].poster.no, 'B');
  assert.equal(rows[0].days, null);
});

test('件数を絞れる', () => {
  const list = [1, 2, 3, 4, 5].map((n) => p({ no: String(n), lastReplacedOn: '2024-01-0' + n }));
  assert.equal(stalest(list, TODAY, 3).length, 3);
});

test('撤去済は古い順に出さない（対応する必要がないため）', () => {
  const list = [
    p({ no: 'A', lastReplacedOn: '2020-01-01', status: '撤去済' }),
    p({ no: 'B', lastReplacedOn: '2025-01-01' }),
  ];
  const rows = stalest(list, TODAY, 10);
  assert.deepEqual(rows.map((r) => r.poster.no), ['B']);
});
