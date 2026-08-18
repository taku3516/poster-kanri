// ピンの色分けルールのテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultColumns, addCustomColumn } from '../public/js/schema.js';
import {
  PALETTE,
  modeForColumn,
  defaultRuleFor,
  REFRESHED_FIELD,
  bucketOf,
  buildLegend,
} from '../public/js/color-rules.js';

const TODAY = '2026-08-18';
const columns = defaultColumns();
const colOf = (label) => columns.find((c) => c.label === label);

const p = (f) => ({ custom: {}, ...f });

// ---------------------------------------------------------------- 方式の決定

test('列の型から色分けの方式が決まる', () => {
  assert.equal(modeForColumn(colOf('最新貼替日')), 'days');
  assert.equal(modeForColumn(colOf('3連大')), 'number');
  assert.equal(modeForColumn(colOf('要脚立')), 'check');
  assert.equal(modeForColumn(colOf('地区')), 'category');
  assert.equal(modeForColumn(colOf('備考')), 'category');
});

test('追加した列でも方式が決まる', () => {
  const cols = addCustomColumn(columns, { label: '訪問回数', type: 'number' });
  assert.equal(modeForColumn(cols.find((c) => c.key === 'c1')), 'number');
});

// ---------------------------------------------------------------- 既定のルール

test('日付の列には期間のしきい値が入る', () => {
  const rule = defaultRuleFor(colOf('最新貼替日'));
  assert.equal(rule.mode, 'days');
  assert.ok(rule.buckets.length >= 2);
  // 最後の区切りは上限なし
  assert.equal(rule.buckets[rule.buckets.length - 1].upTo, null);
});

test('しきい値は小さい順に並んでいる', () => {
  const rule = defaultRuleFor(colOf('最新貼替日'));
  const limits = rule.buckets.map((b) => b.upTo).filter((v) => v !== null);
  for (let i = 1; i < limits.length; i += 1) {
    assert.ok(limits[i - 1] < limits[i], 'しきい値の並びが崩れている');
  }
});

test('色はすべて決められた配色から選ばれる', () => {
  const rule = defaultRuleFor(colOf('最新貼替日'));
  for (const bucket of rule.buckets) {
    assert.ok(Object.hasOwn(PALETTE, bucket.color), '知らない色: ' + bucket.color);
  }
});

// ---------------------------------------------------------------- 経過期間

test('経過が短いほど早い区切りに入る', () => {
  const rule = defaultRuleFor(colOf('最新貼替日'));
  const recent = bucketOf(rule, p({ lastReplacedOn: '2026-08-01' }), TODAY);
  const old = bucketOf(rule, p({ lastReplacedOn: '2021-01-01' }), TODAY);
  assert.notEqual(recent.color, old.color);
  assert.equal(recent.color, rule.buckets[0].color);
  assert.equal(old.color, rule.buckets[rule.buckets.length - 1].color);
});

test('日付が無ければ「不明」の色になる', () => {
  const rule = defaultRuleFor(colOf('最新貼替日'));
  const result = bucketOf(rule, p({ lastReplacedOn: null }), TODAY);
  assert.equal(result.label, '不明');
});

test('「最後に手を入れた日」は貼替日が無ければ掲示日で補う', () => {
  const rule = defaultRuleFor({ key: REFRESHED_FIELD, label: '最後に手を入れた日', type: 'date', system: true });
  const result = bucketOf(rule, p({ lastReplacedOn: null, postedOn: '2026-08-01' }), TODAY);
  assert.notEqual(result.label, '不明');
});

// ---------------------------------------------------------------- 枚数

test('枚数はしきい値で色が変わる', () => {
  const rule = defaultRuleFor(colOf('3連大'));
  assert.equal(rule.mode, 'number');
  const zero = bucketOf(rule, p({ size3L: 0 }), TODAY);
  const many = bucketOf(rule, p({ size3L: 9 }), TODAY);
  assert.notEqual(zero.color, many.color);
});

// ---------------------------------------------------------------- 有無

test('チェックはあり・なしの2色になる', () => {
  const rule = defaultRuleFor(colOf('要脚立'));
  assert.equal(rule.mode, 'check');
  assert.equal(bucketOf(rule, p({ needLadder: true }), TODAY).label, 'あり');
  assert.equal(bucketOf(rule, p({ needLadder: false }), TODAY).label, 'なし');
});

// ---------------------------------------------------------------- カテゴリ

test('値ごとに色が割り当てられ、同じ値には同じ色が付く', () => {
  const rule = defaultRuleFor(colOf('地区'));
  const list = [p({ district: '大井' }), p({ district: '荏原' }), p({ district: '大井' })];
  const legend = buildLegend(rule, list, TODAY);

  const a = bucketOf(rule, list[0], TODAY, legend);
  const c = bucketOf(rule, list[2], TODAY, legend);
  assert.equal(a.color, c.color);

  const b = bucketOf(rule, list[1], TODAY, legend);
  assert.notEqual(a.color, b.color);
});

test('値が空のものは「未設定」にまとめる', () => {
  const rule = defaultRuleFor(colOf('地区'));
  const legend = buildLegend(rule, [p({ district: '' })], TODAY);
  assert.equal(legend[0].label, '未設定');
});

// ---------------------------------------------------------------- 凡例

test('凡例は区切りごとの件数を持つ', () => {
  const rule = defaultRuleFor(colOf('要脚立'));
  const legend = buildLegend(rule, [
    p({ needLadder: true }), p({ needLadder: true }), p({ needLadder: false }),
  ], TODAY);

  const yes = legend.find((row) => row.label === 'あり');
  const no = legend.find((row) => row.label === 'なし');
  assert.equal(yes.count, 2);
  assert.equal(no.count, 1);
});

test('件数が0の区切りは凡例に出さない（読みにくくなるため）', () => {
  const rule = defaultRuleFor(colOf('要脚立'));
  const legend = buildLegend(rule, [p({ needLadder: true })], TODAY);
  assert.deepEqual(legend.map((r) => r.label), ['あり']);
});

test('カテゴリが多すぎるときは上位だけ色を付け、残りはまとめる', () => {
  const rule = defaultRuleFor(colOf('地区'));
  const list = [];
  for (let i = 0; i < 12; i += 1) list.push(p({ district: '地区' + i }));
  const legend = buildLegend(rule, list, TODAY);
  assert.ok(legend.length <= 8, '凡例が多すぎる: ' + legend.length);
  assert.ok(legend.some((row) => row.label === 'その他'));
});
