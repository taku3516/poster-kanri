// 端末内のデータをアカウントへ取り込む処理のテスト。
//
// 取り込み先（クラウド）も同じ関数の並びを持つため、
// テストでは両方をメモリ上の保存先にして確かめられる。
// Firebase に繋がずに取り込みの正しさを検証できる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDb, LOCAL_UID } from '../public/js/local-db.js';
import { createMemoryStorage } from './memory-storage.js';
import { planMigration, runMigration, IMPORTED_SUFFIX } from '../public/js/migrate.js';

const uid = 'user-1';

/** @returns {{local: *, cloud: *}} 端末内とアカウント、2つの保存先 */
function newPair() {
  return { local: createLocalDb(createMemoryStorage()), cloud: createLocalDb(createMemoryStorage()) };
}

// ------------------------------------------------------------------ 計画

test('アカウント側が空なら、そのままの名前で取り込む', () => {
  const plan = planMigration(
    [{ id: 'a', name: '山田太郎' }, { id: 'b', name: '鈴木花子' }],
    [],
  );

  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((p) => p.name), ['山田太郎', '鈴木花子']);
  assert.deepEqual(plan.map((p) => p.sourceId), ['a', 'b']);
});

test('同じ名前がアカウント側にあれば、取り込みと分かる名前にする', () => {
  const plan = planMigration(
    [{ id: 'a', name: '山田太郎' }],
    [{ id: 'x', name: '山田太郎' }],
  );

  assert.equal(plan[0].name, '山田太郎' + IMPORTED_SUFFIX);
  assert.equal(plan[0].renamed, true);
});

test('印を付けた名前もぶつかるなら連番を足す', () => {
  const plan = planMigration(
    [{ id: 'a', name: '山田太郎' }],
    [{ id: 'x', name: '山田太郎' }, { id: 'y', name: '山田太郎' + IMPORTED_SUFFIX }],
  );

  assert.equal(plan[0].name, '山田太郎' + IMPORTED_SUFFIX + ' 2');
});

test('端末内で同じ名前が並んでいても、取り込み後にぶつからない', () => {
  // 端末内では重複を止めていないため、ここで解く必要がある
  const plan = planMigration(
    [{ id: 'a', name: '山田太郎' }, { id: 'b', name: '山田太郎' }],
    [],
  );

  assert.notEqual(plan[0].name, plan[1].name);
});

test('取り込むものが無ければ計画は空', () => {
  assert.deepEqual(planMigration([], [{ id: 'x', name: '山田' }]), []);
});

// ------------------------------------------------------------------ 実行

test('台帳とポスターがアカウント側に入る', async () => {
  const { local, cloud } = newPair();

  const id = await local.createCandidate(LOCAL_UID, '山田太郎');
  await local.createPoster(LOCAL_UID, id, { no: '001', owner: '田中' });
  await local.createPoster(LOCAL_UID, id, { no: '002', owner: '鈴木' });

  const result = await runMigration(local, cloud, uid);

  assert.equal(result.candidates, 1);
  assert.equal(result.posters, 2);

  const list = await cloud.listCandidates(uid);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '山田太郎');

  const posters = await cloud.listPosters(uid, list[0].id);
  assert.equal(posters.length, 2);
  assert.deepEqual(posters.map((p) => p.no).sort(), ['001', '002']);
  assert.equal(posters.find((p) => p.no === '001').owner, '田中');
});

test('列定義と色分けルールも一緒に移る', async () => {
  const { local, cloud } = newPair();

  const id = await local.createCandidate(LOCAL_UID, '山田太郎');
  const columns = (await local.listCandidates(LOCAL_UID))[0].columns;
  const custom = [...columns, { key: 'custom.訪問回数', label: '訪問回数', type: 'number', visible: true }];

  await local.saveColumns(LOCAL_UID, id, custom);
  await local.saveColorRules(LOCAL_UID, id, [{ id: 'r1', label: '経過期間' }], 'r1');

  await runMigration(local, cloud, uid);

  const moved = (await cloud.listCandidates(uid))[0];
  assert.equal(moved.columns.length, custom.length);
  assert.ok(moved.columns.some((c) => c.label === '訪問回数'), '追加した列が移っている');
  assert.equal(moved.activeRuleId, 'r1');
});

test('保管済みの台帳も取り込む（保管済みのまま）', async () => {
  const { local, cloud } = newPair();

  const id = await local.createCandidate(LOCAL_UID, '過去の選挙');
  await local.archiveCandidate(LOCAL_UID, id);

  const result = await runMigration(local, cloud, uid);

  assert.equal(result.candidates, 1);
  assert.equal((await cloud.listCandidates(uid)).length, 0, '一覧には出ない');
  assert.equal((await cloud.listCandidates(uid, { includeArchived: true })).length, 1);
});

test('アカウント側に元からある台帳は一切変えない', async () => {
  const { local, cloud } = newPair();

  const existing = await cloud.createCandidate(uid, '山田太郎');
  await cloud.createPoster(uid, existing, { no: '001', owner: '元からある' });

  const id = await local.createCandidate(LOCAL_UID, '山田太郎');
  await local.createPoster(LOCAL_UID, id, { no: '001', owner: '端末内' });

  await runMigration(local, cloud, uid);

  // 別の台帳として増える。既存の中身は元のまま
  const list = await cloud.listCandidates(uid, { includeArchived: true });
  assert.equal(list.length, 2);

  const before = await cloud.listPosters(uid, existing);
  assert.equal(before.length, 1);
  assert.equal(before[0].owner, '元からある');
});

test('取り込んでも端末内のデータは残る', async () => {
  const { local, cloud } = newPair();

  const id = await local.createCandidate(LOCAL_UID, '山田太郎');
  await local.createPoster(LOCAL_UID, id, { no: '001' });

  await runMigration(local, cloud, uid);

  // 取り消せない操作を自動でしない。消すかどうかは利用者が決める
  assert.equal((await local.listCandidates(LOCAL_UID)).length, 1);
  assert.equal(await local.countPosters(LOCAL_UID, id), 1);
});

test('進み具合を知らせる', async () => {
  const { local, cloud } = newPair();

  await local.createCandidate(LOCAL_UID, '山田');
  await local.createCandidate(LOCAL_UID, '鈴木');

  /** @type {string[]} */
  const seen = [];
  await runMigration(local, cloud, uid, (progress) => seen.push(progress.name));

  assert.deepEqual(seen, ['山田', '鈴木']);
});

test('ポスターが1件も無い台帳も取り込む', async () => {
  const { local, cloud } = newPair();
  await local.createCandidate(LOCAL_UID, '準備中');

  const result = await runMigration(local, cloud, uid);

  assert.equal(result.candidates, 1);
  assert.equal(result.posters, 0);
  assert.equal((await cloud.listCandidates(uid)).length, 1);
});

test('端末内が空なら何もしない', async () => {
  const { local, cloud } = newPair();
  const result = await runMigration(local, cloud, uid);

  assert.deepEqual(result, { candidates: 0, posters: 0 });
});
