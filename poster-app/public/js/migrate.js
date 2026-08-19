// 端末内に貯めたデータを、ログインしたアカウントへ取り込む。
//
// 取り込みは常に「新しい台帳を足す」形で行い、
// アカウント側に元からある台帳には一切手を触れない。
//
// 既存の台帳へ混ぜようとすると、同じ番号のポスターが両方にあったとき
// 「どちらが正しいか」を決めねばならない。これは機械には決められない。
// 混ぜたい場合は、CSV の取り込み（import-plan.js）が使える。
//
// 取り込んでも端末内のデータは消さない。
// 取り消せない操作を、利用者の指示なしに行わないため。

import { LOCAL_UID } from './local-db.js';

/** 取り込んだ台帳だと分かるようにする印 */
export const IMPORTED_SUFFIX = '（この端末から取り込み）';

/**
 * 取り込みの計画。
 * @typedef {object} MigrationItem
 * @property {string} sourceId 端末内での台帳ID
 * @property {string} name 取り込み後に付ける名前
 * @property {boolean} renamed 名前を変えたか
 */

/**
 * 何をどの名前で取り込むかを決める。
 *
 * 名前がぶつかったままだと、切り替えの選択欄で見分けが付かない。
 * 印を付け、それでもぶつかるなら連番を足す。
 *
 * @param {{id: string, name: string}[]} localCandidates 端末内の台帳（保管済みも含む）
 * @param {{name: string}[]} cloudCandidates アカウント側の台帳（保管済みも含む）
 * @returns {MigrationItem[]}
 */
export function planMigration(localCandidates, cloudCandidates) {
  // 端末内どうしでもぶつかり得るので、決めた名前も使用済みに加えていく
  const used = new Set(cloudCandidates.map((c) => String(c.name)));

  /** @type {MigrationItem[]} */
  const plan = [];

  for (const candidate of localCandidates) {
    const original = String(candidate.name ?? '(名称未設定)');
    const name = uniqueName(original, used);

    used.add(name);
    plan.push({ sourceId: candidate.id, name, renamed: name !== original });
  }

  return plan;
}

/**
 * まだ使われていない名前を作る。
 *
 * @param {string} original
 * @param {Set<string>} used
 * @returns {string}
 */
function uniqueName(original, used) {
  if (!used.has(original)) return original;

  const marked = original + IMPORTED_SUFFIX;
  if (!used.has(marked)) return marked;

  // 印を付けてもぶつかる場合だけ連番にする。
  // 最初から連番にすると、1回目の取り込みまで数字が付いて読みにくい
  for (let n = 2; n < 1000; n += 1) {
    const numbered = marked + ' ' + n;
    if (!used.has(numbered)) return numbered;
  }

  // ここまで来ることは実際には無いが、無限に探し続けるよりは印を足して抜ける
  return marked + ' ' + Date.now();
}

/**
 * 取り込みを実行する。
 *
 * 台帳を1つずつ順に処理する。まとめて並行に走らせないのは、
 * 途中で通信が切れたときに「どこまで入ったか」が追えなくなるため。
 *
 * @param {*} localDb 端末内保存（local-db.js）
 * @param {*} cloudDb アカウント側（db.js。テストでは local-db.js）
 * @param {string} uid ログインした利用者のID
 * @param {(progress: {name: string, done: number, total: number}) => void} [onProgress]
 * @returns {Promise<{candidates: number, posters: number}>} 取り込んだ件数
 */
export async function runMigration(localDb, cloudDb, uid, onProgress) {
  const localCandidates = await localDb.listCandidates(LOCAL_UID, { includeArchived: true });
  if (localCandidates.length === 0) return { candidates: 0, posters: 0 };

  const cloudCandidates = await cloudDb.listCandidates(uid, { includeArchived: true });
  const plan = planMigration(localCandidates, cloudCandidates);

  let posters = 0;

  for (const [index, item] of plan.entries()) {
    const source = localCandidates.find((c) => c.id === item.sourceId);
    if (source === undefined) continue;

    const createdId = await cloudDb.createCandidate(uid, item.name);

    // 列定義と色分けのルールは台帳の一部。これが移らないと
    // 追加した列の値が表に出てこない
    await cloudDb.saveColumns(uid, createdId, source.columns);
    if ((source.colorRules ?? []).length > 0) {
      await cloudDb.saveColorRules(uid, createdId, source.colorRules, source.activeRuleId ?? '');
    }

    const sourcePosters = await localDb.listPosters(LOCAL_UID, item.sourceId);
    if (sourcePosters.length > 0) {
      // 端末内でのIDは持ち込まない。取り込み先で新しく採番する
      const stripped = sourcePosters.map(({ id, createdAt, updatedAt, updatedBy, ...rest }) => rest);
      await cloudDb.createPostersBulk(uid, createdId, stripped);
      posters += sourcePosters.length;
    }

    // 保管済みだったものは保管済みのまま入れる。
    // 先に作ってから印を付けるのは、作成時に保管の指定ができないため
    if (source.archived === true) {
      await cloudDb.archiveCandidate(uid, createdId);
    }

    onProgress?.({ name: source.name, done: index + 1, total: plan.length });
  }

  return { candidates: plan.length, posters };
}
