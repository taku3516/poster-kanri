// 列定義まわりのロジックのテスト。
// Firestore に触れない純粋関数だけを対象にしている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_COLUMNS,
  CSV_COLUMN_KEYS,
  defaultColumns,
  nextCustomKey,
  addCustomColumn,
  removeColumn,
  renameColumn,
  createEmptyPoster,
  orderedColumns,
} from '../public/js/schema.js';

test('既定の列に、現行Excelの24項目がすべて含まれる', () => {
  const labels = defaultColumns().map((c) => c.label);
  const excel = [
    '番号', '掲示日', '最新貼替日', '紹介者', '所有者', '電話番号', '携帯番号',
    'メール', '連絡先住所', '掲示場所', '郵便番号', '掲示住所', '地区',
    '詳細エリア', 'マップ掲載', '3連大', '3連小', '2連大', '2連小',
    '要脚立', 'プラ段', '室内', '備考', '他党',
  ];
  for (const label of excel) {
    assert.ok(labels.includes(label), label + ' が無い');
  }
});

test('CSVの先頭24列はExcelの並びと完全に一致する', () => {
  // 既存のExcelでそのまま開けるようにするため、並びまで揃える
  assert.equal(CSV_COLUMN_KEYS.length, 24);
  const byKey = new Map(SYSTEM_COLUMNS.map((c) => [c.key, c.label]));
  assert.deepEqual(
    CSV_COLUMN_KEYS.map((k) => byKey.get(k)),
    [
      '番号', '掲示日', '最新貼替日', '紹介者', '所有者', '電話番号', '携帯番号',
      'メール', '連絡先住所', '掲示場所', '郵便番号', '掲示住所', '地区',
      '詳細エリア', 'マップ掲載', '3連大', '3連小', '2連大', '2連小',
      '要脚立', 'プラ段', '室内', '備考', '他党',
    ],
  );
});

test('他党は文字列ではなくチェック項目である', () => {
  const col = defaultColumns().find((c) => c.label === '他党');
  assert.equal(col.type, 'check');
});

test('3連大などの種別は数値（枚数）である', () => {
  for (const label of ['3連大', '3連小', '2連大', '2連小']) {
    const col = defaultColumns().find((c) => c.label === label);
    assert.equal(col.type, 'number', label + ' が数値でない');
  }
});

test('カスタム列のキーは c1 から順に振られる', () => {
  const cols = defaultColumns();
  assert.equal(nextCustomKey(cols), 'c1');
});

test('カスタム列を足すとキーが増えていく', () => {
  let cols = defaultColumns();
  cols = addCustomColumn(cols, { label: '回覧板担当', type: 'text' });
  cols = addCustomColumn(cols, { label: '訪問回数', type: 'number' });

  const custom = cols.filter((c) => !c.system);
  assert.deepEqual(custom.map((c) => c.key), ['c1', 'c2']);
  assert.deepEqual(custom.map((c) => c.label), ['回覧板担当', '訪問回数']);
});

test('同じ列名でも別の列として足せる（キーが違うため）', () => {
  let cols = defaultColumns();
  cols = addCustomColumn(cols, { label: '担当', type: 'text' });
  cols = addCustomColumn(cols, { label: '担当', type: 'text' });
  const custom = cols.filter((c) => !c.system);
  assert.equal(custom.length, 2);
  assert.notEqual(custom[0].key, custom[1].key);
});

test('知らない型のカスタム列は足せない', () => {
  const cols = defaultColumns();
  assert.throws(() => addCustomColumn(cols, { label: 'x', type: '画像' }));
});

test('列名が空のカスタム列は足せない', () => {
  const cols = defaultColumns();
  assert.throws(() => addCustomColumn(cols, { label: '   ', type: 'text' }));
});

test('列名を変えてもキーは変わらない（データ移行が要らない）', () => {
  let cols = defaultColumns();
  cols = addCustomColumn(cols, { label: '回覧板担当', type: 'text' });
  cols = renameColumn(cols, 'c1', 'ポスター担当');

  const col = cols.find((c) => c.key === 'c1');
  assert.equal(col.label, 'ポスター担当');
  assert.equal(col.key, 'c1');
});

test('カスタム列は削除できる', () => {
  let cols = defaultColumns();
  cols = addCustomColumn(cols, { label: '一時的な列', type: 'text' });
  cols = removeColumn(cols, 'c1');
  assert.equal(cols.filter((c) => !c.system).length, 0);
});

test('固定項目は削除できない（台帳の骨格が壊れるため）', () => {
  const cols = defaultColumns();
  assert.throws(() => removeColumn(cols, 'no'));
});

test('新しいポスターは型ごとの初期値で埋まる', () => {
  const cols = defaultColumns();
  const poster = createEmptyPoster(cols);

  assert.equal(poster.no, '');            // 文字列
  assert.equal(poster.size3L, 0);         // 数値（枚数）
  assert.equal(poster.needLadder, false); // チェック
  assert.equal(poster.otherParty, false); // チェック
  assert.equal(poster.postedOn, null);    // 日付は未入力を null で持つ
  assert.deepEqual(poster.custom, {});
});

test('カスタム列があれば新しいポスターの custom も埋まる', () => {
  let cols = defaultColumns();
  cols = addCustomColumn(cols, { label: '訪問回数', type: 'number' });
  const poster = createEmptyPoster(cols);
  assert.equal(poster.custom.c1, 0);
});

test('マップ掲載の初期値は true（既定で地図に出す）', () => {
  const poster = createEmptyPoster(defaultColumns());
  assert.equal(poster.showOnMap, true);
});

test('表示する列は並び順に並び、非表示は除かれる', () => {
  let cols = defaultColumns();
  cols = addCustomColumn(cols, { label: '備考2', type: 'text' });
  cols = cols.map((c) => (c.key === 'no' ? { ...c, visible: false } : c));

  const shown = orderedColumns(cols);
  assert.ok(!shown.some((c) => c.key === 'no'));
  for (let i = 1; i < shown.length; i += 1) {
    assert.ok(shown[i - 1].order <= shown[i].order, '並び順が崩れている');
  }
});
