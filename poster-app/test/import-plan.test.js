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

// ------------------------------------------------------------ 貼替履歴の列

test('貼替1 貼替2 … の列から履歴を組み立てる', () => {
  const plan = buildImportPlan(
    csv('番号|貼替1|貼替2', '001|2024-03-01|2025-11-10'),
    [existing({ id: 'a', no: '001' })],
    columns, 'merge',
  );

  assert.deepEqual(plan.update[0].poster.replacements, ['2024-03-01', '2025-11-10']);
  assert.equal(plan.update[0].poster.lastReplacedOn, '2025-11-10');
});

test('貼替の列は「台帳に無い列」として扱わない', () => {
  // 見出しは台帳の列名と一致しないが、追加を勧めてはいけない。
  const plan = buildImportPlan(
    csv('番号|貼替1', '001|2024-03-01'),
    [existing({ id: 'a', no: '001' })],
    columns, 'merge',
  );

  assert.deepEqual(plan.unknownColumns, []);
});

test('空欄の貼替列は飛ばして詰める', () => {
  // 回数の少ない行は右側が空欄。そこを履歴の穴にしない。
  const plan = buildImportPlan(
    csv('番号|貼替1|貼替2|貼替3', '001|2024-03-01||'),
    [existing({ id: 'a', no: '001' })],
    columns, 'merge',
  );

  assert.deepEqual(plan.update[0].poster.replacements, ['2024-03-01']);
});

test('貼替の列が無いCSVでは、最新貼替日は訂正として扱う（履歴は増えない）', () => {
  // 履歴を運んでいないCSVから「貼り替えがあった」とは判断できない。
  // 推測して足すと、Excel側の打ち直しまで実績として数えてしまう。
  const plan = buildImportPlan(
    csv('番号|最新貼替日', '001|2026-01-10'),
    [existing({ id: 'a', no: '001', replacements: ['2024-03-01', '2025-11-10'], lastReplacedOn: '2025-11-10' })],
    columns, 'merge',
  );

  assert.deepEqual(plan.update[0].poster.replacements, ['2024-03-01', '2026-01-10']);
  assert.equal(plan.update[0].poster.lastReplacedOn, '2026-01-10');
});

test('貼替の列も最新貼替日も無ければ、履歴はそのまま残る', () => {
  const plan = buildImportPlan(
    csv('番号|所有者', '001|田中'),
    [existing({ id: 'a', no: '001', replacements: ['2024-03-01'], lastReplacedOn: '2024-03-01' })],
    columns, 'merge',
  );

  assert.deepEqual(plan.update[0].poster.replacements, ['2024-03-01']);
  assert.equal(plan.update[0].poster.lastReplacedOn, '2024-03-01');
});

test('貼替の列と最新貼替日が食い違えば、履歴を採って知らせる', () => {
  // 履歴の列があるときはそちらが本体。黙って捨てずに警告に出す。
  const plan = buildImportPlan(
    csv('番号|最新貼替日|貼替1', '001|2026-01-10|2024-03-01'),
    [existing({ id: 'a', no: '001' })],
    columns, 'merge',
  );

  assert.deepEqual(plan.update[0].poster.replacements, ['2024-03-01']);
  assert.equal(plan.update[0].poster.lastReplacedOn, '2024-03-01');
  assert.deepEqual(plan.historyConflicts, ['001']);
});

test('新規の行にも履歴が入る', () => {
  const plan = buildImportPlan(
    csv('番号|貼替1|貼替2', '007|2024-03-01|2025-11-10'),
    [], columns, 'merge',
  );

  assert.deepEqual(plan.add[0].poster.replacements, ['2024-03-01', '2025-11-10']);
  assert.equal(plan.add[0].poster.lastReplacedOn, '2025-11-10');
});

test('書き出したCSVを取り込むと、貼替履歴がそのまま戻る', async () => {
  // 書き出しと取り込みで列名の付け方がずれていないかを、繋いで確かめる。
  // 片方だけ直したときにここで落ちる。
  const { buildCsv, parseCsv } = await import('../public/js/csv.js');

  const before = [
    { ...existing({ id: 'a', no: '001' }), replacements: ['2024-03-01', '2025-11-10'], lastReplacedOn: '2025-11-10' },
    { ...existing({ id: 'b', no: '002' }), replacements: ['2025-06-05'], lastReplacedOn: '2025-06-05' },
    { ...existing({ id: 'c', no: '003' }), replacements: [], lastReplacedOn: null },
  ];

  const plan = buildImportPlan(parseCsv(buildCsv(before, columns)), before, columns, 'merge');

  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.unknownColumns, []);
  assert.deepEqual(plan.historyConflicts, []);

  const after = Object.fromEntries(plan.update.map((u) => [u.poster.no, u.poster]));
  assert.deepEqual(after['001'].replacements, ['2024-03-01', '2025-11-10']);
  assert.deepEqual(after['002'].replacements, ['2025-06-05']);
  assert.deepEqual(after['003'].replacements, []);
  assert.equal(after['001'].lastReplacedOn, '2025-11-10');
  assert.equal(after['003'].lastReplacedOn, null);
});

test('書き出したCSVの貼替の列を1つ足すと、1回分増えて戻る', async () => {
  // 秘書がExcelで右に1列足して日付を書く、という使い方。
  const { buildCsv, parseCsv } = await import('../public/js/csv.js');

  const before = [
    { ...existing({ id: 'a', no: '001' }), replacements: ['2024-03-01'], lastReplacedOn: '2024-03-01' },
  ];

  const rows = parseCsv(buildCsv(before, columns));
  rows[0].push('貼替2');
  rows[1].push('2026-08-19');

  const plan = buildImportPlan(rows, before, columns, 'merge');

  assert.deepEqual(plan.update[0].poster.replacements, ['2024-03-01', '2026-08-19']);
  assert.equal(plan.update[0].poster.lastReplacedOn, '2026-08-19');
});
