// 共有する内容の組み立てのテスト。
//
// ここで最も大事なのは「氏名と連絡先が出ないこと」。
// 除外リストで消すのではなく、そもそも組み立てていないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareSummary, summaryToText } from '../public/js/share.js';

const TODAY = '2026-08-18';

/** @param {object} f */
const p = (f = {}) => ({
  no: '', postedOn: null, lastReplacedOn: null, district: '',
  owner: '', introducer: '', phone: '', mobile: '', email: '', contactAddress: '',
  placeName: '', address: '',
  size3L: 0, size3S: 0, size2L: 0, size2S: 0,
  needLadder: false, plaDan: false, indoor: false, otherParty: false,
  showOnMap: true, lat: 35.6, lng: 139.7, status: '掲示中', custom: {}, ...f,
});

// ------------------------------------------------------------ 個人情報

test('氏名も連絡先も、共有する内容には一切現れない', () => {
  const posters = [p({
    no: '001', owner: '木村次郎', introducer: '山田美咲',
    phone: '03-1234-5678', mobile: '090-1234-5678',
    email: 'x@example.com', contactAddress: '品川区大井一丁目2-3',
    placeName: '個人宅 塀', address: '品川区大井一丁目2-3',
    district: '大井',
  })];

  const text = JSON.stringify(buildShareSummary(posters, TODAY, '山田太郎'));

  for (const secret of ['木村次郎', '山田美咲', '03-1234-5678', '090-1234-5678',
    'x@example.com', '品川区大井一丁目2-3', '個人宅 塀']) {
    assert.ok(!text.includes(secret), secret + ' が共有内容に出ている');
  }
});

test('地区名は出る（場所の傾向を伝えるため。個人は特定されない）', () => {
  const summary = buildShareSummary([p({ district: '大井' })], TODAY, '山田太郎');
  assert.ok(JSON.stringify(summary).includes('大井'));
});

test('候補者名は出る（誰の台帳かが分からないと共有の意味がない）', () => {
  assert.equal(buildShareSummary([p()], TODAY, '山田太郎').title, '山田太郎 ポスター掲示状況');
});

// ------------------------------------------------------------ 中身

test('概要には件数と枚数を出す', () => {
  const summary = buildShareSummary(
    [p({ size3L: 2 }), p({ size2S: 1 })], TODAY, '山田太郎',
  );

  assert.equal(summary.headline.find((h) => h.label === '掲示場所').value, 2);
  assert.equal(summary.headline.find((h) => h.label === '掲示枚数').value, 3);
});

test('撤去済は数えない', () => {
  const summary = buildShareSummary(
    [p(), p({ status: '撤去済' })], TODAY, '山田太郎',
  );
  assert.equal(summary.headline.find((h) => h.label === '掲示場所').value, 1);
});

test('区分ごとの内訳を並べる', () => {
  const summary = buildShareSummary([p({ needLadder: true })], TODAY, '山田太郎');
  const labels = summary.sections.map((s) => s.title);

  assert.deepEqual(labels, ['ポスター種別', '現場の条件', '貼替からの経過', '貼替の回数', '地区別（上位10）']);
});

test('地区は多い順に10件まで', () => {
  const posters = [];
  for (let i = 0; i < 12; i += 1) {
    for (let n = 0; n <= i; n += 1) posters.push(p({ district: '地区' + i }));
  }

  const rows = buildShareSummary(posters, TODAY, '山田太郎')
    .sections.find((s) => s.title.startsWith('地区別')).rows;

  assert.equal(rows.length, 10);
  assert.equal(rows[0].label, '地区11');
});

test('0件の区分も残す（該当が無いことが見えるように）', () => {
  const summary = buildShareSummary([p()], TODAY, '山田太郎');
  const rows = summary.sections.find((s) => s.title === '貼替の回数').rows;

  assert.deepEqual(rows.map((r) => r.label), ['0回', '1回', '2回', '3回以上']);
});

test('日付を入れる（いつ時点の数字か分からないと使えない）', () => {
  assert.equal(buildShareSummary([p()], TODAY, '山田太郎').asOf, TODAY);
});

// ------------------------------------------------------------ 文章にする

test('文章にしても氏名は出ない', () => {
  const posters = [p({ owner: '木村次郎', introducer: '山田美咲', district: '大井' })];
  const text = summaryToText(buildShareSummary(posters, TODAY, '山田太郎'));

  assert.ok(!text.includes('木村次郎'));
  assert.ok(!text.includes('山田美咲'));
});

test('文章には表題と日付と区分が入る', () => {
  const text = summaryToText(buildShareSummary([p({ size3L: 1 })], TODAY, '山田太郎'));

  assert.ok(text.includes('山田太郎 ポスター掲示状況'));
  assert.ok(text.includes('2026-08-18'));
  assert.ok(text.includes('ポスター種別'));
  assert.ok(text.includes('3連大'));
});

test('件数が0の行は文章では省く（読む量を増やさない）', () => {
  // 画像は場所があるので0も並べるが、文章は縦に伸びると読まれない。
  const text = summaryToText(buildShareSummary([p({ size3L: 1 })], TODAY, '山田太郎'));
  assert.ok(!text.includes('2連小'));
});

// ------------------------------------------------------------ 画像の大きさ

test('画像の高さは中身から先に決まる', async () => {
  // 描きながら伸ばすと途中で足りなくなり、描き直しになる。
  const { measureHeight } = await import('../public/js/share-image.js');
  const few = buildShareSummary([p({ district: '大井' })], TODAY, '山田太郎');

  const many = buildShareSummary(
    Array.from({ length: 30 }, (_, i) => p({ district: '地区' + (i % 12) })),
    TODAY, '山田太郎',
  );

  assert.ok(measureHeight(few) > 0);
  assert.ok(measureHeight(many) > measureHeight(few), '地区が増えれば高くなる');
});

// -------------------------------------------- 氏名・連絡先を含める（明示的に）

test('既定では氏名を含む区分そのものを組み立てない', () => {
  // 作ってから消すのではなく、作らない。消し漏れが即そのまま流出になるため。
  const summary = buildShareSummary([p({ owner: '木村次郎' })], TODAY, '山田太郎');
  assert.ok(!summary.sections.some((s) => s.title.includes('所有者')));
  assert.ok(!summary.sections.some((s) => s.title.includes('紹介者')));
  assert.equal(summary.includesPersonal, false);
});

test('含めると指定したときだけ、氏名の区分が加わる', () => {
  const posters = [
    p({ no: '1', owner: '木村次郎', introducer: '山田美咲' }),
    p({ no: '2', owner: '木村次郎', introducer: '山田美咲' }),
  ];
  const summary = buildShareSummary(posters, TODAY, '山田太郎', { includePersonal: true });

  assert.equal(summary.includesPersonal, true);
  const owner = summary.sections.find((s) => s.title.includes('所有者'));
  const intro = summary.sections.find((s) => s.title.includes('紹介者'));

  assert.equal(owner.rows[0].label, '木村次郎');
  assert.equal(owner.rows[0].value, 2);
  assert.equal(intro.rows[0].label, '山田美咲');
});

test('含めると、貼替が古い場所を掲示場所と住所つきで並べる', () => {
  const posters = [p({
    no: '001', placeName: '大井一丁目 個人宅 塀', address: '品川区大井一丁目2-3',
    lastReplacedOn: '2024-01-01',
  })];

  const section = buildShareSummary(posters, TODAY, '山田太郎', { includePersonal: true })
    .sections.find((s) => s.title.includes('貼替から間があいて'));

  assert.equal(section.rows[0].label, '大井一丁目 個人宅 塀');
  assert.equal(section.rows[0].note, '品川区大井一丁目2-3');
  assert.equal(section.rows[0].unit, '日');
});

test('含める指定でも、数だけの区分は今までどおり出る', () => {
  const summary = buildShareSummary([p()], TODAY, '山田太郎', { includePersonal: true });
  assert.ok(summary.sections.some((s) => s.title === 'ポスター種別'));
});

test('文章にも氏名の区分が入る', () => {
  const posters = [p({ no: '1', owner: '木村次郎' }), p({ no: '2', owner: '木村次郎' })];
  const text = summaryToText(buildShareSummary(posters, TODAY, '山田太郎', { includePersonal: true }));

  assert.ok(text.includes('木村次郎'));
});

test('文章では住所を掲示場所の後ろに添える', () => {
  const posters = [p({
    placeName: '個人宅 塀', address: '品川区大井一丁目2-3', lastReplacedOn: '2024-01-01',
  })];
  const text = summaryToText(buildShareSummary(posters, TODAY, '山田太郎', { includePersonal: true }));

  assert.ok(text.includes('個人宅 塀'));
  assert.ok(text.includes('品川区大井一丁目2-3'));
});

test('貼替日も掲示日も無い場所は、経過の一覧には並べない', () => {
  // 経過が数えられないものを 0日 として並べると、棒が短く出て
  // 「最近貼った場所」に見えてしまう。件数は「貼替からの経過」の
  // 「日付なし」で分かるので、そちらに任せる。
  const posters = [
    p({ placeName: '日付なしの場所' }),
    p({ placeName: '古い場所', lastReplacedOn: '2024-01-01' }),
  ];

  const rows = buildShareSummary(posters, TODAY, '山田太郎', { includePersonal: true })
    .sections.find((s) => s.title.includes('貼替から間があいて')).rows;

  assert.deepEqual(rows.map((r) => r.label), ['古い場所']);
});

// -------------------------------------------------------- 一覧の行を送る

const cols = (await import('../public/js/schema.js')).defaultColumns();

test('見えている列を、行ごとの箇条書きにする', async () => {
  const { postersToText } = await import('../public/js/share.js');
  const rows = [p({ no: '001', placeName: '大井一丁目 塀', size2S: 2 })];

  const text = postersToText(rows, cols, { title: '山田太郎', asOf: TODAY, condition: '要脚立' });

  assert.ok(text.includes('山田太郎'));
  assert.ok(text.includes(TODAY));
  assert.ok(text.includes('要脚立'));
  assert.ok(text.includes('001'));
  assert.ok(text.includes('大井一丁目 塀'));
});

test('既定では氏名も連絡先も送らない', async () => {
  const { postersToText } = await import('../public/js/share.js');
  const rows = [p({
    no: '001', owner: '木村次郎', introducer: '山田美咲',
    phone: '03-1234-5678', mobile: '090-1234-5678',
    email: 'x@example.com', contactAddress: '品川区大井一丁目2-3',
  })];

  const text = postersToText(rows, cols, { title: '山田太郎', asOf: TODAY, condition: '' });

  for (const secret of ['木村次郎', '山田美咲', '03-1234-5678', '090-1234-5678',
    'x@example.com', '品川区大井一丁目2-3']) {
    assert.ok(!text.includes(secret), secret + ' が出ている');
  }
});

test('含めると指定したときは氏名も連絡先も送る', async () => {
  const { postersToText } = await import('../public/js/share.js');
  const rows = [p({ no: '001', owner: '木村次郎', phone: '03-1234-5678' })];

  const text = postersToText(rows, cols, {
    title: '山田太郎', asOf: TODAY, condition: '', includeContact: true,
  });

  assert.ok(text.includes('木村次郎'));
  assert.ok(text.includes('03-1234-5678'));
});

test('空の欄は書かない（縦に伸びると読まれない）', async () => {
  const { postersToText } = await import('../public/js/share.js');
  const text = postersToText([p({ no: '001' })], cols, { title: 'あ', asOf: TODAY, condition: '' });

  assert.ok(!text.includes('備考'));
  assert.ok(!text.includes('掲示場所'));
});

test('隠している列は送らない（印刷と同じ扱い）', async () => {
  const { postersToText } = await import('../public/js/share.js');
  const hidden = cols.map((c) => (c.key === 'placeName' ? { ...c, visible: false } : c));
  const rows = [p({ no: '001', placeName: '出てはいけない' })];

  const text = postersToText(rows, hidden, { title: 'あ', asOf: TODAY, condition: '' });
  assert.ok(!text.includes('出てはいけない'));
});

test('件数を先頭に出す', async () => {
  const { postersToText } = await import('../public/js/share.js');
  const text = postersToText([p({ no: '1' }), p({ no: '2' })], cols,
    { title: 'あ', asOf: TODAY, condition: '' });

  assert.ok(text.includes('2 件'));
});

test('枚数が0の欄は書かない', async () => {
  // 台帳では 0 と空欄は別物だが、送る文章では「3連大 0」が並ぶだけで
  // 読む量が増える。0枚は「無い」と読めるので省く。
  const { postersToText } = await import('../public/js/share.js');
  const text = postersToText([p({ no: '001', size3L: 0, size2S: 2 })], cols,
    { title: 'あ', asOf: TODAY, condition: '' });

  assert.ok(!text.includes('3連大'));
  assert.ok(text.includes('2連小 2'));
});
