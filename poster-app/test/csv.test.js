// CSVの読み書きのテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultColumns, addCustomColumn } from '../public/js/schema.js';
import {
  parseCsv, buildCsv, csvHeader, toCheckValue, fromCheckValue, decodeCsvBytes, withBom,
} from '../public/js/csv.js';

const columns = defaultColumns();

// ---------------------------------------------------------------- 読み取り

test('ふつうの行を読める', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('引用符の中の区切り文字は分けない', () => {
  // 住所に「1-2,3」のような書き方が混じっても壊れないこと
  assert.deepEqual(parseCsv('a,"b,c",d'), [['a', 'b,c', 'd']]);
});

test('引用符の中の引用符は二重で表す', () => {
  assert.deepEqual(parseCsv('a,"い""ろ""は",c'), [['a', 'い"ろ"は', 'c']]);
});

test('引用符の中の改行は行を分けない', () => {
  // 備考に改行が入っていても1件として読む
  assert.deepEqual(parseCsv('a,"1行目\n2行目",c'), [['a', '1行目\n2行目', 'c']]);
});

test('CRLF でも読める（Excelが書き出す形）', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('末尾の空行は無視する', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
});

test('空の欄は空文字になる', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
});

test('BOM は取り除く', () => {
  assert.deepEqual(parseCsv('﻿番号,掲示場所'), [['番号', '掲示場所']]);
});

// ---------------------------------------------------------------- 書き出し

test('見出しは現行Excelの24列が先頭に来る', () => {
  const header = csvHeader(columns);
  assert.deepEqual(header.slice(0, 24), [
    '番号', '掲示日', '最新貼替日', '紹介者', '所有者', '電話番号', '携帯番号',
    'メール', '連絡先住所', '掲示場所', '郵便番号', '掲示住所', '地区',
    '詳細エリア', 'マップ掲載', '3連大', '3連小', '2連大', '2連小',
    '要脚立', 'プラ段', '室内', '備考', '他党',
  ]);
});

test('24列のあとに緯度経度などが並ぶ', () => {
  const header = csvHeader(columns);
  assert.ok(header.includes('緯度'));
  assert.ok(header.includes('経度'));
  assert.ok(header.indexOf('緯度') >= 24);
});

test('追加した列は最後に並ぶ', () => {
  const cols = addCustomColumn(columns, { label: '回覧板担当', type: 'text' });
  const header = csvHeader(cols);
  assert.equal(header[header.length - 1], '回覧板担当');
});

test('区切り文字や引用符を含む値は引用する', () => {
  const cols = defaultColumns();
  const text = buildCsv([{ note: 'あ,い"う', custom: {} }], cols);
  assert.ok(text.includes('"あ,い""う"'), text);
});

test('改行を含む値も引用する', () => {
  const text = buildCsv([{ note: '1行目\n2行目', custom: {} }], defaultColumns());
  assert.ok(text.includes('"1行目\n2行目"'));
});

test('書いたものを読み戻すと同じ値になる', () => {
  const cols = defaultColumns();
  const poster = {
    no: '001', owner: 'あ,い', note: '1行目\n2行目', size3L: 2,
    needLadder: true, otherParty: false, lastReplacedOn: '2026-08-01',
    lat: 35.60516, lng: 139.73468, custom: {},
  };
  const rows = parseCsv(buildCsv([poster], cols));
  const header = rows[0];
  const values = rows[1];
  const at = (label) => values[header.indexOf(label)];

  assert.equal(at('番号'), '001');
  assert.equal(at('所有者'), 'あ,い');
  assert.equal(at('備考'), '1行目\n2行目');
  assert.equal(at('3連大'), '2');
  assert.equal(at('最新貼替日'), '2026-08-01');
  assert.equal(at('緯度'), '35.60516');
});

// ---------------------------------------------------------------- チェック項目

test('チェックは○と空で書き出す', () => {
  assert.equal(toCheckValue(true), '○');
  assert.equal(toCheckValue(false), '');
});

test('チェックの読み取りは書き方の揺れを吸収する', () => {
  // 手元のExcelがどの書き方でも取り込めるようにする
  for (const yes of ['○', '◯', '●', '1', 'はい', 'TRUE', 'true', '✓', 'yes', 'Y']) {
    assert.equal(fromCheckValue(yes), true, yes + ' が true にならない');
  }
  for (const no of ['', '0', 'いいえ', 'FALSE', 'false', '×', '－', '-']) {
    assert.equal(fromCheckValue(no), false, no + ' が false にならない');
  }
});

// ---------------------------------------------------------------- 文字コード

test('BOM付きUTF-8を読める', () => {
  const bytes = withBom('番号,掲示場所');
  assert.equal(decodeCsvBytes(bytes), '番号,掲示場所');
});

test('BOMなしUTF-8を読める', () => {
  const bytes = new TextEncoder().encode('番号,掲示場所');
  assert.equal(decodeCsvBytes(bytes), '番号,掲示場所');
});

test('Shift_JISを読める', () => {
  // 「品川区」の Shift_JIS
  const bytes = new Uint8Array([0x95, 0x69, 0x90, 0xEC, 0x8B, 0xE6]);
  assert.equal(decodeCsvBytes(bytes), '品川区');
});

test('書き出しにはBOMを付ける（Excelで文字化けさせないため）', () => {
  const bytes = withBom('あ');
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
});
