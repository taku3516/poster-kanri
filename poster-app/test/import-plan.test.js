// CSV取り込み計画のテスト。確定前に何が起きるかを組み立てる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultColumns, addCustomColumn } from '../public/js/schema.js';
import { buildImportPlan } from '../public/js/import-plan.js';

const columns = defaultColumns();

/** 見出し行つきのCSV行を作る */
const csv = (...lines) => lines.map((l) => l.split('|'));

const existing = (f) => ({ id: 'x', no: '', custom: {}, ...f });

// ---------------------------------------------------------------- 追加と更新

test('番号が一致すれば更新、無ければ追加', () => {
  const plan = buildImportPlan(
    csv('番号|所有者', '001|田中', '002|鈴木'),
    [existing({ id: 'a', no: '001', owner: '古い' })],
    columns, 'merge',
  );
  assert.equal(plan.update.length, 1);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.update[0].id, 'a');
  assert.equal(plan.update[0].poster.owner, '田中');
});

test('差分マージでは、CSVに無い既存の行は残す', () => {
  const plan = buildImportPlan(
    csv('番号|所有者', '001|田中'),
    [existing({ id: 'a', no: '001' }), existing({ id: 'b', no: '999' })],
    columns, 'merge',
  );
  assert.equal(plan.remove.length, 0);
});

test('全置換では、CSVに無い既存の行は削除の対象になる', () => {
  const plan = buildImportPlan(
    csv('番号|所有者', '001|田中'),
    [existing({ id: 'a', no: '001' }), existing({ id: 'b', no: '999' })],
    columns, 'replace',
  );
  assert.deepEqual(plan.remove.map((r) => r.id), ['b']);
});

// ---------------------------------------------------------------- 型の変換

test('型に合わせて値を変える', () => {
  const plan = buildImportPlan(
    csv('番号|3連大|要脚立|最新貼替日', '001|2|○|2026-08-01'),
    [], columns, 'merge',
  );
  const p = plan.add[0].poster;
  assert.equal(p.size3L, 2);
  assert.equal(p.needLadder, true);
  assert.equal(p.lastReplacedOn, '2026-08-01');
});

test('チェックの書き方の揺れを吸収する', () => {
  const plan = buildImportPlan(
    csv('番号|要脚立|プラ段|室内', '001|1|はい|×'),
    [], columns, 'merge',
  );
  const p = plan.add[0].poster;
  assert.equal(p.needLadder, true);
  assert.equal(p.plaDan, true);
  assert.equal(p.indoor, false);
});

test('CSVに無い列は、既存の値をそのまま残す', () => {
  // 一部の列だけ入ったCSVで、触っていない列が消えないこと
  const plan = buildImportPlan(
    csv('番号|所有者', '001|新しい'),
    [existing({ id: 'a', no: '001', owner: '古い', phone: '03-1111-2222' })],
    columns, 'merge',
  );
  assert.equal(plan.update[0].poster.phone, '03-1111-2222');
});

// ---------------------------------------------------------------- 重複の検出

test('CSVの中で番号が重複していたら知らせる', () => {
  // どちらが正か機械には決められないので、黙って片方を採らない
  const plan = buildImportPlan(
    csv('番号|所有者', '001|田中', '001|鈴木'),
    [], columns, 'merge',
  );
  assert.deepEqual(plan.duplicateNos, ['001']);
  assert.ok(plan.blocked);
});

test('掲示住所の重複は警告にとどめる', () => {
  // 同じ建物に複数枚ということもあり得るので、止めはしない
  const plan = buildImportPlan(
    csv('番号|掲示住所', '001|品川区大井1-2-3', '002|品川区大井1-2-3'),
    [], columns, 'merge',
  );
  assert.deepEqual(plan.duplicateAddresses, ['品川区大井1-2-3']);
  assert.equal(plan.blocked, false);
});

test('番号が空の行は取り込めないものとして知らせる', () => {
  // 突合の鍵が無く、次回の更新で必ず二重登録になる
  const plan = buildImportPlan(
    csv('番号|所有者', '|田中'),
    [], columns, 'merge',
  );
  assert.equal(plan.add.length, 0);
  assert.equal(plan.errors.length, 1);
});

// ---------------------------------------------------------------- 列の食い違い

test('知らない列があれば名前を挙げる', () => {
  const plan = buildImportPlan(
    csv('番号|回覧板担当', '001|山本'),
    [], columns, 'merge',
  );
  assert.deepEqual(plan.unknownColumns, ['回覧板担当']);
});

test('追加した列と一致すれば、知らない列にはならない', () => {
  const cols = addCustomColumn(columns, { label: '回覧板担当', type: 'text' });
  const plan = buildImportPlan(
    csv('番号|回覧板担当', '001|山本'),
    [], cols, 'merge',
  );
  assert.deepEqual(plan.unknownColumns, []);
  assert.equal(plan.add[0].poster.custom.c1, '山本');
});

test('見出しに番号が無ければ取り込めない', () => {
  const plan = buildImportPlan(csv('所有者', '田中'), [], columns, 'merge');
  assert.ok(plan.blocked);
  assert.ok(plan.errors.some((e) => e.includes('番号')));
});

test('中身が無いCSVは取り込めない', () => {
  const plan = buildImportPlan([], [], columns, 'merge');
  assert.ok(plan.blocked);
});
