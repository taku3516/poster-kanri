// 端末内保存（未ログイン時の保存先）のテスト。
//
// ここで確かめているのは local-db.js の振る舞いだけでなく、
// db.js（Firestore版）が満たしている「契約」でもある。
// ログインの前後で画面の挙動が変わらないことが要点。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDb, LOCAL_UID } from '../public/js/local-db.js';
import { createMemoryStorage } from './memory-storage.js';

/** @returns {ReturnType<typeof createLocalDb>} */
function newDb() {
  return createLocalDb(createMemoryStorage());
}

const uid = LOCAL_UID;

// ------------------------------------------------------------------ 候補者

test('候補者を作ると一覧に出る', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田太郎');

  const list = await db.listCandidates(uid);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, '山田太郎');
  assert.equal(list[0].archived, false);
  // 列定義は既定のものが入る（Firestore版と同じ）
  assert.ok(list[0].columns.length > 0);
});

test('候補者名が空なら作らない', async () => {
  const db = newDb();
  await assert.rejects(() => db.createCandidate(uid, '   '), /候補者名/);
});

test('候補者名の前後の空白は落とす', async () => {
  const db = newDb();
  await db.createCandidate(uid, '  山田太郎  ');
  const list = await db.listCandidates(uid);
  assert.equal(list[0].name, '山田太郎');
});

test('一覧は名前順に並ぶ', async () => {
  const db = newDb();
  await db.createCandidate(uid, '鈴木');
  await db.createCandidate(uid, 'あべ');
  await db.createCandidate(uid, '佐藤');

  const names = (await db.listCandidates(uid)).map((c) => c.name);
  assert.deepEqual(names, ['あべ', '佐藤', '鈴木']);
});

test('保管した候補者は既定では一覧に出ない', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  await db.archiveCandidate(uid, id);

  assert.equal((await db.listCandidates(uid)).length, 0);
  assert.equal((await db.listCandidates(uid, { includeArchived: true })).length, 1);

  await db.restoreCandidate(uid, id);
  assert.equal((await db.listCandidates(uid)).length, 1);
});

test('候補者の名前を変えられる', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  await db.renameCandidate(uid, id, '山田太郎');
  assert.equal((await db.listCandidates(uid))[0].name, '山田太郎');
});

test('列定義を保存できる', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  const columns = (await db.listCandidates(uid))[0].columns;
  const next = columns.map((c) => ({ ...c, visible: false }));

  await db.saveColumns(uid, id, next);
  assert.equal((await db.listCandidates(uid))[0].columns.every((c) => !c.visible), true);
});

test('色分けルールを保存できる', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  await db.saveColorRules(uid, id, [{ id: 'r1', label: '経過期間' }], 'r1');

  const candidate = (await db.listCandidates(uid))[0];
  assert.equal(candidate.colorRules.length, 1);
  assert.equal(candidate.activeRuleId, 'r1');
});

// ------------------------------------------------------------------ ポスター

test('ポスターを足すと数えられる', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');

  await db.createPoster(uid, id, { no: '001', address: '品川区大井1-2-3' });
  await db.createPoster(uid, id, { no: '002', address: '品川区大井4-5-6' });

  assert.equal(await db.countPosters(uid, id), 2);
});

test('別の候補者のポスターは混ざらない', async () => {
  const db = newDb();
  const a = await db.createCandidate(uid, '山田');
  const b = await db.createCandidate(uid, '鈴木');

  await db.createPoster(uid, a, { no: '001' });
  await db.createPoster(uid, b, { no: '001' });
  await db.createPoster(uid, b, { no: '002' });

  assert.equal(await db.countPosters(uid, a), 1);
  assert.equal(await db.countPosters(uid, b), 2);
});

test('ポスターの保存は丸ごと置き換える', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  const posterId = await db.createPoster(uid, id, { no: '001', owner: '田中', note: '朝のみ' });

  // note を持たない内容で保存すると、古い値は残らない
  await db.savePoster(uid, id, posterId, { no: '001', owner: '鈴木' });

  const posters = await db.listPosters(uid, id);
  assert.equal(posters[0].owner, '鈴木');
  assert.equal(posters[0].note, undefined);
});

test('一括更新は指定した項目だけを書き換える', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  const a = await db.createPoster(uid, id, { no: '001', owner: '田中', note: '朝のみ' });
  const b = await db.createPoster(uid, id, { no: '002', owner: '鈴木', note: '' });

  await db.updatePostersBulk(uid, id, [a, b], { status: '掲示中' });

  const posters = await db.listPosters(uid, id);
  const byNo = Object.fromEntries(posters.map((p) => [p.no, p]));
  assert.equal(byNo['001'].status, '掲示中');
  assert.equal(byNo['001'].note, '朝のみ'); // 触っていない項目は残る
  assert.equal(byNo['002'].owner, '鈴木');
});

test('行ごとに違う内容を当てられる', async () => {
  // 貼替履歴のように「今その行が何を持っているか」で書く内容が変わる更新は、
  // 共通の patch では表せない。
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  const a = await db.createPoster(uid, id, { no: '001', note: '朝のみ' });
  const b = await db.createPoster(uid, id, { no: '002', note: '' });

  const count = await db.updatePostersEach(uid, id, [
    { id: a, patch: { replacements: ['2026-08-01'], lastReplacedOn: '2026-08-01' } },
    { id: b, patch: { replacements: ['2024-01-01', '2026-08-01'], lastReplacedOn: '2026-08-01' } },
  ]);

  assert.equal(count, 2);
  const posters = await db.listPosters(uid, id);
  const byNo = Object.fromEntries(posters.map((p) => [p.no, p]));
  assert.deepEqual(byNo['001'].replacements, ['2026-08-01']);
  assert.deepEqual(byNo['002'].replacements, ['2024-01-01', '2026-08-01']);
  assert.equal(byNo['001'].note, '朝のみ'); // 触っていない項目は残る
});

test('まとめて足せる（件数が多くても分割せず入る）', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');

  const posters = Array.from({ length: 450 }, (_, i) => ({ no: String(i + 1) }));
  const added = await db.createPostersBulk(uid, id, posters);

  assert.equal(added, 450);
  assert.equal(await db.countPosters(uid, id), 450);
});

test('ポスターを消せる', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');
  const posterId = await db.createPoster(uid, id, { no: '001' });

  await db.deletePoster(uid, id, posterId);
  assert.equal(await db.countPosters(uid, id), 0);
});

test('候補者を完全に消すとポスターも消える', async () => {
  const db = newDb();
  const a = await db.createCandidate(uid, '山田');
  const b = await db.createCandidate(uid, '鈴木');
  await db.createPoster(uid, a, { no: '001' });
  await db.createPoster(uid, a, { no: '002' });
  await db.createPoster(uid, b, { no: '001' });

  const removed = await db.deleteCandidateForever(uid, a);

  assert.equal(removed, 2);
  assert.equal((await db.listCandidates(uid)).length, 1);
  // 残した候補者のポスターは巻き込まれない
  assert.equal(await db.countPosters(uid, b), 1);
});

// ------------------------------------------------------------------ 見張り

test('ポスターの変化が見張りに伝わる', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');

  /** @type {Record<string, *>[][]} */
  const received = [];
  const unwatch = db.watchPosters(uid, id, (posters) => received.push(posters), () => {});

  // 見張りを始めた直後に、その時点の中身が一度届く
  await waitFor(() => received.length === 1);
  assert.equal(received[0].length, 0);

  await db.createPoster(uid, id, { no: '001' });
  await waitFor(() => received.length === 2);
  assert.equal(received[1].length, 1);

  unwatch();

  await db.createPoster(uid, id, { no: '002' });
  await tick();
  assert.equal(received.length, 2, '止めた後は届かない');
});

test('見張りは自分の候補者の変化だけを受け取る', async () => {
  const db = newDb();
  const a = await db.createCandidate(uid, '山田');
  const b = await db.createCandidate(uid, '鈴木');

  /** @type {number[]} */
  const counts = [];
  const unwatch = db.watchPosters(uid, a, (posters) => counts.push(posters.length), () => {});
  await waitFor(() => counts.length === 1);

  await db.createPoster(uid, b, { no: '001' });
  await tick();
  assert.equal(counts.length, 1, '別の候補者の変化では呼ばれない');

  unwatch();
});

test('見張りには同期の状態も渡る（端末内保存であることが分かる）', async () => {
  const db = newDb();
  const id = await db.createCandidate(uid, '山田');

  /** @type {{fromCache: boolean, pending: boolean}[]} */
  const syncs = [];
  const unwatch = db.watchPosters(uid, id, (_posters, sync) => syncs.push(sync), () => {});
  await waitFor(() => syncs.length === 1);

  // 端末内保存に「送信待ち」は無い。同期の帯を出す理由が無いことを表す
  assert.equal(syncs[0].pending, false);
  assert.equal(syncs[0].fromCache, false);
  unwatch();
});

// ------------------------------------------------------------------ 補助

/** @returns {Promise<void>} */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 条件が満たされるまで待つ。見張りの通知は非同期に届くため。
 * @param {() => boolean} condition
 * @returns {Promise<void>}
 */
async function waitFor(condition) {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await tick();
  }
  throw new Error('待っても条件が満たされなかった');
}
