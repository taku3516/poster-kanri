// 未保存の変更があるかの判定のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultColumns, addCustomColumn, createEmptyPoster } from '../public/js/schema.js';
import { hasChanges } from '../public/js/changes.js';

const columns = defaultColumns();

test('開いて何も触らなければ変更なし', () => {
  const poster = { id: 'a', ...createEmptyPoster(columns), owner: '田中' };
  const draft = { ...poster, custom: { ...poster.custom } };
  assert.equal(hasChanges(poster, draft, columns), false);
});

test('値を変えれば変更あり', () => {
  const poster = { id: 'a', ...createEmptyPoster(columns), owner: '田中' };
  const draft = { ...poster, owner: '鈴木' };
  assert.equal(hasChanges(poster, draft, columns), true);
});

test('管理用の項目が違っても変更とみなさない', () => {
  // updatedAt などを比べると、開いて閉じただけで「変更あり」になり
  // 警告が形骸化する
  const poster = { id: 'a', ...createEmptyPoster(columns), updatedAt: 1, updatedBy: 'x' };
  const draft = { ...poster, updatedAt: 2, updatedBy: 'y' };
  assert.equal(hasChanges(poster, draft, columns), false);
});

test('カスタム列の変更も見る', () => {
  const cols = addCustomColumn(columns, { label: '訪問回数', type: 'number' });
  const poster = { id: 'a', ...createEmptyPoster(cols) };
  const draft = { ...poster, custom: { ...poster.custom, c1: 3 } };
  assert.equal(hasChanges(poster, draft, cols), true);
});

test('新規のとき、何も入れていなければ変更なし', () => {
  // 番号は自動で入るので、それだけでは「入力した」とみなさない
  const empty = { ...createEmptyPoster(columns), no: '045' };
  assert.equal(hasChanges(null, empty, columns), false);
});

test('新規で何か入れていれば変更あり', () => {
  const draft = { ...createEmptyPoster(columns), no: '045', placeName: '大井町駅前' };
  assert.equal(hasChanges(null, draft, columns), true);
});

test('新規で番号を手で変えた場合は変更あり', () => {
  const draft = { ...createEmptyPoster(columns), no: 'A-1' };
  assert.equal(hasChanges(null, draft, columns), true);
});

test('地図から作った新規は、住所が入っているので変更あり', () => {
  const draft = {
    ...createEmptyPoster(columns), no: '045',
    lat: 35.6, lng: 139.7, address: '品川区大井一丁目',
  };
  assert.equal(hasChanges(null, draft, columns), true);
});

test('数値の 0 と空文字を取り違えない', () => {
  const poster = { id: 'a', ...createEmptyPoster(columns) };
  const draft = { ...poster, size3L: 0 };
  assert.equal(hasChanges(poster, draft, columns), false);
});

test('チェックの付け外しも見る', () => {
  const poster = { id: 'a', ...createEmptyPoster(columns) };
  const draft = { ...poster, needLadder: true };
  assert.equal(hasChanges(poster, draft, columns), true);
});
