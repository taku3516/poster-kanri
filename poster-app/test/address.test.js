// 住所から地区（町字）と詳細エリア（町丁目）を切り出すテスト。
// 通信は伴わない。国土地理院APIが返す「正規化済みの住所」を入力とする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHalfWidthDigits, toKanjiNumber, parseAddress } from '../public/js/address.js';

test('全角の数字を半角にする', () => {
  assert.equal(toHalfWidthDigits('大井１丁目２番３号'), '大井1丁目2番3号');
});

test('数を漢数字にする', () => {
  assert.equal(toKanjiNumber(1), '一');
  assert.equal(toKanjiNumber(5), '五');
  assert.equal(toKanjiNumber(10), '十');
  assert.equal(toKanjiNumber(11), '十一');
  assert.equal(toKanjiNumber(20), '二十');
  assert.equal(toKanjiNumber(23), '二十三');
});

test('品川区の住所から町字と町丁目を取り出す', () => {
  assert.deepEqual(parseAddress('東京都品川区大井一丁目２番３号'), {
    district: '大井',
    areaDetail: '大井一丁目',
  });
});

test('町名が長くても正しく切れる', () => {
  assert.deepEqual(parseAddress('東京都品川区西五反田八丁目１番'), {
    district: '西五反田',
    areaDetail: '西五反田八丁目',
  });
});

test('半角数字の丁目も漢数字に揃える', () => {
  // 表記が揺れても、地区の集計が分かれないようにする
  assert.deepEqual(parseAddress('品川区荏原3丁目1番1号'), {
    district: '荏原',
    areaDetail: '荏原三丁目',
  });
});

test('丁目を持たない町は、丁目を作らない', () => {
  // 東八潮に丁目は存在しない。正規化結果も「１番」であり「一丁目」ではない。
  // ここで機械的に丁目を付けると、存在しない町丁目が生まれる
  assert.deepEqual(parseAddress('東京都品川区東八潮１番'), {
    district: '東八潮',
    areaDetail: '東八潮',
  });
});

test('品川区以外は「区外」とし、詳細エリアに市区町村を入れる', () => {
  assert.deepEqual(parseAddress('東京都大田区中央一丁目１番'), {
    district: '区外',
    areaDetail: '大田区',
  });
});

test('他県でも市区町村を取り出せる', () => {
  assert.deepEqual(parseAddress('神奈川県川崎市川崎区駅前本町１番'), {
    district: '区外',
    areaDetail: '川崎市',
  });
});

test('空の住所では何も返さない（誤った値で埋めない）', () => {
  assert.deepEqual(parseAddress(''), { district: '', areaDetail: '' });
  assert.deepEqual(parseAddress(null), { district: '', areaDetail: '' });
});

test('市区町村が読み取れない文字列でも落ちない', () => {
  assert.deepEqual(parseAddress('どこか'), { district: '', areaDetail: '' });
});

test('「品川区」を含む他県の地名に引きずられない', () => {
  // 「品川区」という文字が県名の後ろに無い場合を誤判定しないこと
  const result = parseAddress('東京都品川区南品川二丁目１番');
  assert.deepEqual(result, { district: '南品川', areaDetail: '南品川二丁目' });
});
