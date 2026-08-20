// 貼替履歴のテスト。
//
// 要点は「既存データを書き換えずに読めるか」。
// replacements を持たないポスターは、lastReplacedOn を1件の履歴として扱う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyOf,
  addReplacement,
  removeReplacement,
  correctLatest,
  fromDates,
} from '../public/js/replacements.js';

/** @param {object} f */
const p = (f) => ({ no: '', postedOn: null, lastReplacedOn: null, ...f });

// ------------------------------------------------------------ 履歴の読み取り

test('履歴が無いポスターは、最新貼替日を1件の履歴として読む', () => {
  // 既存データを書き換えずに済ませるための落とし方。
  assert.deepEqual(historyOf(p({ lastReplacedOn: '2025-05-05' })), ['2025-05-05']);
});

test('最新貼替日も無ければ履歴は空', () => {
  assert.deepEqual(historyOf(p({})), []);
});

test('履歴があればそちらを使う', () => {
  const poster = p({ replacements: ['2023-01-10', '2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(historyOf(poster), ['2023-01-10', '2025-05-05']);
});

test('履歴は昇順に並べ、重複と空を取り除く', () => {
  const poster = p({ replacements: ['2025-05-05', '', '2023-01-10', '2025-05-05', null] });
  assert.deepEqual(historyOf(poster), ['2023-01-10', '2025-05-05']);
});

test('日付として読めない値は履歴に入れない', () => {
  // CSVから来た「不明」「2025年」のような書き方を弾く。
  const poster = p({ replacements: ['2023-01-10', '不明', '2025/05/05'] });
  assert.deepEqual(historyOf(poster), ['2023-01-10']);
});

test('履歴が空でも最新貼替日があれば拾う', () => {
  // 履歴を全部消した後に日付だけ残っている、という食い違いを起こさない。
  const poster = p({ replacements: [], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(historyOf(poster), ['2025-05-05']);
});

// -------------------------------------------------------------- 貼替を足す

test('貼替を足すと履歴と最新貼替日の両方が変わる', () => {
  const poster = p({ lastReplacedOn: '2023-01-10' });
  assert.deepEqual(addReplacement(poster, '2025-05-05'), {
    replacements: ['2023-01-10', '2025-05-05'],
    lastReplacedOn: '2025-05-05',
  });
});

test('一度も貼り替えていない場所に足せる', () => {
  assert.deepEqual(addReplacement(p({ postedOn: '2022-04-01' }), '2025-05-05'), {
    replacements: ['2025-05-05'],
    lastReplacedOn: '2025-05-05',
  });
});

test('同じ日を二度足しても増えない', () => {
  // 現地で「今日にする」を二度押しても実績が二重にならないようにする。
  const poster = p({ replacements: ['2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(addReplacement(poster, '2025-05-05'), {
    replacements: ['2025-05-05'],
    lastReplacedOn: '2025-05-05',
  });
});

test('最新より古い日を足しても、最新貼替日は下がらない', () => {
  // 過去の貼替を後から入力する場合。履歴には入るが「最新」は最新のまま。
  const poster = p({ replacements: ['2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(addReplacement(poster, '2023-01-10'), {
    replacements: ['2023-01-10', '2025-05-05'],
    lastReplacedOn: '2025-05-05',
  });
});

test('日付として読めない値は足さない', () => {
  const poster = p({ lastReplacedOn: '2023-01-10' });
  assert.equal(addReplacement(poster, '不明'), null);
});

// ------------------------------------------------------------ 貼替を取り消す

test('貼替を取り消すと履歴から消え、最新貼替日が前の回に戻る', () => {
  // 押し間違いを直せること。ここが無いと履歴は増える一方になる。
  const poster = p({ replacements: ['2023-01-10', '2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(removeReplacement(poster, '2025-05-05'), {
    replacements: ['2023-01-10'],
    lastReplacedOn: '2023-01-10',
  });
});

test('最後の1件を取り消すと最新貼替日は空になる', () => {
  const poster = p({ replacements: ['2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(removeReplacement(poster, '2025-05-05'), {
    replacements: [],
    lastReplacedOn: null,
  });
});

test('履歴に無い日を取り消しても何も起きない', () => {
  const poster = p({ replacements: ['2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.equal(removeReplacement(poster, '2024-01-01'), null);
});

// ---------------------------------------------------------- 最新の1件を訂正

test('日付の打ち間違いは、履歴を増やさずに直す', () => {
  // 「貼り替えた」のではなく「入力を間違えた」場合。実績を二重に数えない。
  const poster = p({ replacements: ['2023-01-10', '2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(correctLatest(poster, '2025-05-06'), {
    replacements: ['2023-01-10', '2025-05-06'],
    lastReplacedOn: '2025-05-06',
  });
});

test('訂正で前の回より古くすると、並びは正される', () => {
  const poster = p({ replacements: ['2023-01-10', '2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(correctLatest(poster, '2022-01-01'), {
    replacements: ['2022-01-01', '2023-01-10'],
    lastReplacedOn: '2023-01-10',
  });
});

test('履歴が無いポスターへの訂正は、1件目の記録になる', () => {
  assert.deepEqual(correctLatest(p({}), '2025-05-05'), {
    replacements: ['2025-05-05'],
    lastReplacedOn: '2025-05-05',
  });
});

test('訂正で空にすると、最新の1件が消える', () => {
  const poster = p({ replacements: ['2023-01-10', '2025-05-05'], lastReplacedOn: '2025-05-05' });
  assert.deepEqual(correctLatest(poster, ''), {
    replacements: ['2023-01-10'],
    lastReplacedOn: '2023-01-10',
  });
});

// ------------------------------------------------ 日付の並びから組み立てる

test('日付の並びをそのまま履歴にする', () => {
  assert.deepEqual(fromDates(['2025-05-05', '2023-01-10']), {
    replacements: ['2023-01-10', '2025-05-05'],
    lastReplacedOn: '2025-05-05',
  });
});

test('空欄と読めない値は捨てる', () => {
  // CSVの右側は空欄になる。そこを履歴の穴にしない。
  assert.deepEqual(fromDates(['2023-01-10', '', null, '不明']), {
    replacements: ['2023-01-10'],
    lastReplacedOn: '2023-01-10',
  });
});

test('空の並びからは空の履歴になる', () => {
  assert.deepEqual(fromDates([]), { replacements: [], lastReplacedOn: null });
});
