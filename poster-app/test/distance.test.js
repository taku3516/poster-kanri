// 現在地からの距離のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceMeters,
  formatDistance,
  sortByDistance,
  withinMeters,
} from '../public/js/distance.js';

// 大井町駅と品川区役所のあたり
const OIMACHI = { lat: 35.60627, lng: 139.73399 };
const KUYAKUSHO = { lat: 35.60920, lng: 139.73020 };

const p = (f) => ({ id: 'x', lat: null, lng: null, custom: {}, ...f });

test('同じ地点なら0メートル', () => {
  assert.equal(distanceMeters(OIMACHI, OIMACHI), 0);
});

test('近い2地点の距離が妥当な範囲に収まる', () => {
  // 大井町駅〜品川区役所はおよそ450m。誤差100m以内なら実用上十分
  const d = distanceMeters(OIMACHI, KUYAKUSHO);
  assert.ok(d > 350 && d < 550, '距離が想定外: ' + d);
});

test('距離は向きによらず同じ', () => {
  assert.equal(
    Math.round(distanceMeters(OIMACHI, KUYAKUSHO)),
    Math.round(distanceMeters(KUYAKUSHO, OIMACHI)),
  );
});

test('緯度1度はおよそ111km', () => {
  const d = distanceMeters({ lat: 35, lng: 139 }, { lat: 36, lng: 139 });
  assert.ok(d > 110000 && d < 112000, '距離が想定外: ' + d);
});

test('メートルとキロメートルを読みやすく出し分ける', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(87), '87 m');
  assert.equal(formatDistance(999), '999 m');
  assert.equal(formatDistance(1000), '1.0 km');
  assert.equal(formatDistance(1450), '1.5 km');
});

test('距離が分からないときは空文字', () => {
  assert.equal(formatDistance(null), '');
});

test('近い順に並べ替えられる', () => {
  const list = [
    p({ id: 'far', lat: 35.65, lng: 139.75 }),
    p({ id: 'near', lat: 35.6065, lng: 139.7342 }),
    p({ id: 'mid', lat: 35.62, lng: 139.74 }),
  ];
  const sorted = sortByDistance(list, OIMACHI);
  assert.deepEqual(sorted.map((x) => x.id), ['near', 'mid', 'far']);
});

test('座標が無いものは最後に置く', () => {
  const list = [p({ id: 'none' }), p({ id: 'near', lat: 35.6065, lng: 139.7342 })];
  const sorted = sortByDistance(list, OIMACHI);
  assert.deepEqual(sorted.map((x) => x.id), ['near', 'none']);
});

test('並べ替えは元の配列を変えない', () => {
  const list = [
    p({ id: 'a', lat: 35.65, lng: 139.75 }),
    p({ id: 'b', lat: 35.6065, lng: 139.7342 }),
  ];
  sortByDistance(list, OIMACHI);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
});

test('現在地が無ければ並べ替えない', () => {
  const list = [p({ id: 'a' }), p({ id: 'b' })];
  assert.deepEqual(sortByDistance(list, null).map((x) => x.id), ['a', 'b']);
});

test('指定した距離の中にあるものだけを取れる', () => {
  const list = [
    p({ id: 'near', lat: 35.6065, lng: 139.7342 }),
    p({ id: 'far', lat: 35.65, lng: 139.75 }),
  ];
  assert.deepEqual(withinMeters(list, OIMACHI, 500).map((x) => x.id), ['near']);
});

test('現在地が無ければ絞り込まない', () => {
  const list = [p({ id: 'a' }), p({ id: 'b' })];
  assert.equal(withinMeters(list, null, 500).length, 2);
});
