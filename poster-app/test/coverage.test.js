// 人口あたりのカバー率のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageByTown, formatPer10k, BASIS } from '../public/js/coverage.js';

// 検査用の小さな人口表。[人口, 18歳以上]
const TABLE = {
  大井: [30000, 25000],
  荏原: [20000, 10000],
  東八潮: [1000, 800],
};

const p = (f) => ({
  district: '', status: '掲示中',
  size3L: 0, size3S: 0, size2L: 0, size2S: 0, custom: {}, ...f,
});

test('ポスターが1枚も無い地区も一覧に出る', () => {
  // ここが要点。無い地区が消えると、最も手薄な場所が画面から見えなくなる
  const rows = coverageByTown([p({ district: '大井', size3L: 5 })], TABLE, BASIS.voters);
  const names = rows.map((r) => r.district);
  assert.ok(names.includes('荏原'), '掲示が無い地区が落ちている');
  assert.ok(names.includes('東八潮'));
});

test('手薄な地区が先頭に来る', () => {
  const rows = coverageByTown([
    p({ district: '大井', size3L: 25 }),   // 有権者25000 → 10枚/万人
    p({ district: '荏原', size3L: 1 }),    // 有権者10000 → 1枚/万人
  ], TABLE, BASIS.voters);

  assert.equal(rows[0].district, '東八潮'); // 0枚
  assert.equal(rows[1].district, '荏原');
  assert.equal(rows[2].district, '大井');
});

test('有権者1万人あたりの枚数を計算する', () => {
  const rows = coverageByTown([p({ district: '荏原', size3L: 5 })], TABLE, BASIS.voters);
  const ebara = rows.find((r) => r.district === '荏原');
  // 5枚 ÷ 10000人 × 10000 = 5.0
  assert.equal(Math.round(ebara.per10k * 10) / 10, 5);
});

test('分母を総人口に切り替えられる', () => {
  const rows = coverageByTown([p({ district: '荏原', size3L: 5 })], TABLE, BASIS.population);
  const ebara = rows.find((r) => r.district === '荏原');
  // 5枚 ÷ 20000人 × 10000 = 2.5
  assert.equal(Math.round(ebara.per10k * 10) / 10, 2.5);
});

test('件数と枚数も持つ', () => {
  const rows = coverageByTown([
    p({ district: '大井', size3L: 2 }),
    p({ district: '大井', size2S: 1 }),
  ], TABLE, BASIS.voters);
  const oi = rows.find((r) => r.district === '大井');
  assert.equal(oi.count, 2);
  assert.equal(oi.sheets, 3);
});

test('撤去済は数えない', () => {
  const rows = coverageByTown([
    p({ district: '大井', size3L: 5, status: '撤去済' }),
  ], TABLE, BASIS.voters);
  assert.equal(rows.find((r) => r.district === '大井').sheets, 0);
});

test('人口表に無い地区（区外・未設定）は対象外として別に数える', () => {
  // 分母が無いので率を出せない。混ぜると意味のない順位になる
  const rows = coverageByTown([
    p({ district: '区外', size3L: 3 }),
    p({ district: '', size3L: 1 }),
    p({ district: '大井', size3L: 1 }),
  ], TABLE, BASIS.voters);

  assert.ok(!rows.some((r) => r.district === '区外'));
  assert.ok(!rows.some((r) => r.district === ''));
  assert.equal(rows.excluded, 2);
});

test('人口が0の地区では率を出さない（0で割らない）', () => {
  const rows = coverageByTown([], { 空町: [0, 0] }, BASIS.voters);
  assert.equal(rows[0].per10k, null);
});

test('率の表示は小数第1位まで', () => {
  assert.equal(formatPer10k(2.456), '2.5');
  assert.equal(formatPer10k(0), '0.0');
  assert.equal(formatPer10k(null), '—');
});

test('分母が小さすぎる地区は順位から外す', () => {
  // 有権者184人の地区に2枚あると108枚/万人になる。数字は正しくても
  // 「充実している」とは読めず、外れ値が他の地区の棒を潰す
  const table = { 大井: [30000, 25000], 広町: [203, 184] };
  const rows = coverageByTown(
    [p({ district: '広町', size3L: 2 }), p({ district: '大井', size3L: 5 })],
    table, BASIS.voters, 1000,
  );
  assert.ok(!rows.some((r) => r.district === '広町'));
  assert.deepEqual(rows.smallPopulation.map((r) => r.district), ['広町']);
});

test('外した地区の掲示枚数は分かるようにしておく', () => {
  const table = { 広町: [203, 184] };
  const rows = coverageByTown([p({ district: '広町', size3L: 2 })], table, BASIS.voters, 1000);
  assert.equal(rows.smallPopulation[0].sheets, 2);
});

test('下限を指定しなければ全地区を並べる', () => {
  const table = { 広町: [203, 184] };
  const rows = coverageByTown([], table, BASIS.voters);
  assert.equal(rows.length, 1);
});
