// 端末内保存。ログインしていない間の保存先。
//
// db.js（Firestore版）と同じ関数の並びを持つ。
// 画面側（main.js）はどちらを渡されても同じように呼べるため、
// ログインの前後で挙動が変わらない。
//
// データの形:
//   candidates … 台帳（候補者）
//   posters    … ポスター掲示場所。candidateId でどの台帳のものかを持つ
//
// Firestore の入れ子と違い、ここは1階層に平たく置いて candidateId で絞る。
// 端末内で扱う件数（多くて数千件）では絞り込みの費用が問題にならず、
// 保存の入れ物を単純に保てるため。

import { defaultColumns, withSystemColumns } from './schema.js';

/**
 * 未ログイン時の利用者ID。
 * 画面側は state.uid をそのまま渡してくるため、値の形を合わせておく。
 * 端末内保存では利用者の区別が無いので、この関数群は uid を使わない。
 */
export const LOCAL_UID = 'local';

const CANDIDATES = 'candidates';
const POSTERS = 'posters';

/**
 * 保存の入れ物。IndexedDB でもメモリでも、この形さえ満たせば差し込める。
 *
 * @typedef {object} LocalStorageAdapter
 * @property {(store: string) => Promise<Record<string, *>[]>} getAll 全件取り出す
 * @property {(store: string, value: Record<string, *>) => Promise<void>} put id をキーに保存する
 * @property {(store: string, id: string) => Promise<void>} remove 1件消す
 */

/**
 * 端末内保存の一式を作る。
 *
 * @param {LocalStorageAdapter} storage 保存の入れ物
 * @returns {object} db.js と同じ関数の並び
 */
export function createLocalDb(storage) {
  /**
   * ポスターの変化を見張っている相手。
   * 候補者IDごとに、通知先の関数を持つ。
   * @type {Map<string, Set<(posters: Record<string, *>[]) => void>>}
   */
  const watchers = new Map();

  /**
   * ある候補者を見張っている相手全員に、今の中身を届ける。
   * 書き込みのたびに呼ぶ。
   *
   * @param {string} candidateId
   * @returns {Promise<void>}
   */
  async function notify(candidateId) {
    const listeners = watchers.get(candidateId);
    if (listeners === undefined || listeners.size === 0) return;

    const posters = await listPosters(LOCAL_UID, candidateId);
    for (const listener of listeners) listener(posters);
  }

  /**
   * 候補者を1件取り出す。
   * @param {string} candidateId
   * @returns {Promise<Record<string, *>>}
   * @throws {Error} 見つからないとき
   */
  async function findCandidate(candidateId) {
    const all = await storage.getAll(CANDIDATES);
    const found = all.find((c) => c.id === candidateId);
    if (found === undefined) throw new Error('候補者が見つかりません');
    return found;
  }

  /**
   * 候補者の一部の項目だけを書き換える。
   * @param {string} candidateId
   * @param {Record<string, *>} patch
   * @returns {Promise<void>}
   */
  async function patchCandidate(candidateId, patch) {
    const candidate = await findCandidate(candidateId);
    await storage.put(CANDIDATES, { ...candidate, ...patch, updatedAt: Date.now() });
  }

  // ---------------------------------------------------------------- 候補者

  /**
   * 候補者の一覧を取り出す。保管済みは既定で除く。
   *
   * @param {string} _uid 端末内保存では使わない
   * @param {{includeArchived?: boolean}} [options]
   * @returns {Promise<Record<string, *>[]>}
   */
  async function listCandidates(_uid, options = {}) {
    const all = await storage.getAll(CANDIDATES);

    const shaped = all.map((c) => ({
      id: c.id,
      name: c.name ?? '(名称未設定)',
      archived: c.archived === true,
      columns: withSystemColumns(c.columns ?? defaultColumns()),
      colorRules: c.colorRules ?? [],
      activeRuleId: c.activeRuleId ?? '',
    }));

    // Firestore 版は orderBy('name') で並べている。同じ順にする
    shaped.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    return options.includeArchived === true ? shaped : shaped.filter((c) => !c.archived);
  }

  /**
   * 候補者を新しく作る。
   *
   * @param {string} _uid
   * @param {string} name
   * @returns {Promise<string>} 作られたID
   * @throws {Error} 名前が空のとき
   */
  async function createCandidate(_uid, name) {
    const trimmed = String(name ?? '').trim();
    if (trimmed === '') throw new Error('候補者名を入力してください');

    const id = newId();
    await storage.put(CANDIDATES, {
      id,
      name: trimmed,
      archived: false,
      columns: defaultColumns(),
      colorRules: [],
      activeRuleId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return id;
  }

  /**
   * 候補者の名前を変える。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @param {string} name
   * @returns {Promise<void>}
   * @throws {Error} 名前が空のとき
   */
  async function renameCandidate(_uid, candidateId, name) {
    const trimmed = String(name ?? '').trim();
    if (trimmed === '') throw new Error('候補者名を入力してください');
    await patchCandidate(candidateId, { name: trimmed });
  }

  /**
   * 列定義を保存する。
   * @param {string} _uid
   * @param {string} candidateId
   * @param {import('./schema.js').Column[]} columns
   * @returns {Promise<void>}
   */
  async function saveColumns(_uid, candidateId, columns) {
    await patchCandidate(candidateId, { columns });
  }

  /**
   * 色分けルールと、選んでいるルールを保存する。
   * @param {string} _uid
   * @param {string} candidateId
   * @param {object[]} colorRules
   * @param {string} activeRuleId
   * @returns {Promise<void>}
   */
  async function saveColorRules(_uid, candidateId, colorRules, activeRuleId) {
    await patchCandidate(candidateId, { colorRules, activeRuleId });
  }

  /**
   * 候補者を保管する（一覧から外すが消さない）。
   * @param {string} _uid
   * @param {string} candidateId
   * @returns {Promise<void>}
   */
  async function archiveCandidate(_uid, candidateId) {
    await patchCandidate(candidateId, { archived: true });
  }

  /**
   * 保管した候補者を戻す。
   * @param {string} _uid
   * @param {string} candidateId
   * @returns {Promise<void>}
   */
  async function restoreCandidate(_uid, candidateId) {
    await patchCandidate(candidateId, { archived: false });
  }

  /**
   * 候補者とそのポスターを完全に削除する。取り消せない。
   *
   * Firestore 版と同じく、先にポスターを消してから候補者を消す。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @returns {Promise<number>} 消したポスターの件数
   */
  async function deleteCandidateForever(_uid, candidateId) {
    const posters = await listPosters(LOCAL_UID, candidateId);

    for (const poster of posters) await storage.remove(POSTERS, poster.id);
    await storage.remove(CANDIDATES, candidateId);

    watchers.delete(candidateId);
    return posters.length;
  }

  /**
   * ポスターの件数を数える。
   * @param {string} _uid
   * @param {string} candidateId
   * @returns {Promise<number>}
   */
  async function countPosters(_uid, candidateId) {
    return (await listPosters(LOCAL_UID, candidateId)).length;
  }

  // ---------------------------------------------------------------- ポスター

  /**
   * ある候補者のポスターを全件取り出す。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @returns {Promise<Record<string, *>[]>}
   */
  async function listPosters(_uid, candidateId) {
    const all = await storage.getAll(POSTERS);
    return all
      .filter((p) => p.candidateId === candidateId)
      .map(({ candidateId: _ignored, ...poster }) => poster);
  }

  /**
   * ポスターの変化を見張る。
   *
   * Firestore 版の onSnapshot に合わせ、始めた直後に今の中身が一度届く。
   * 端末内保存なので「送信待ち」は起こり得ず、同期の状態は常に落ち着いた値を返す。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @param {(posters: Record<string, *>[], sync: {fromCache: boolean, pending: boolean}) => void} onChange
   * @param {(error: Error) => void} onError
   * @returns {() => void} 見張りを止める関数
   */
  function watchPosters(_uid, candidateId, onChange, onError) {
    /** @param {Record<string, *>[]} posters @returns {void} */
    const listener = (posters) => onChange(posters, { fromCache: false, pending: false });

    if (!watchers.has(candidateId)) watchers.set(candidateId, new Set());
    /** @type {Set<*>} */ (watchers.get(candidateId)).add(listener);

    // 始めた直後の1回。onSnapshot と同じく非同期に届ける
    listPosters(LOCAL_UID, candidateId).then(listener).catch(onError);

    return () => {
      watchers.get(candidateId)?.delete(listener);
    };
  }

  /**
   * ポスターを1件足す。
   * @param {string} _uid
   * @param {string} candidateId
   * @param {Record<string, *>} poster
   * @returns {Promise<string>} 作られたID
   */
  async function createPoster(_uid, candidateId, poster) {
    const id = newId();
    await storage.put(POSTERS, {
      ...poster,
      id,
      candidateId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      updatedBy: LOCAL_UID,
    });

    await notify(candidateId);
    return id;
  }

  /**
   * ポスターを丸ごと保存し直す。
   *
   * 差分ではなく置き換え。列を消したときに古い値が残らないようにするため
   * （Firestore 版の setDoc(merge:false) と同じ意図）。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @param {string} posterId
   * @param {Record<string, *>} poster
   * @returns {Promise<void>}
   */
  async function savePoster(_uid, candidateId, posterId, poster) {
    const { id: _id, createdAt, ...rest } = poster;
    const existing = (await storage.getAll(POSTERS)).find((p) => p.id === posterId);

    await storage.put(POSTERS, {
      ...rest,
      id: posterId,
      candidateId,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      updatedBy: LOCAL_UID,
    });

    await notify(candidateId);
  }

  /**
   * ポスターを1件消す。
   * @param {string} _uid
   * @param {string} candidateId
   * @param {string} posterId
   * @returns {Promise<void>}
   */
  async function deletePoster(_uid, candidateId, posterId) {
    await storage.remove(POSTERS, posterId);
    await notify(candidateId);
  }

  /**
   * ポスターをまとめて足す。
   *
   * Firestore 版は500件の上限があるため分割しているが、
   * 端末内保存に上限は無い。分割せずに入れる。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @param {Record<string, *>[]} posters
   * @returns {Promise<number>} 足した件数
   */
  async function createPostersBulk(_uid, candidateId, posters) {
    for (const poster of posters) {
      await storage.put(POSTERS, {
        ...poster,
        id: newId(),
        candidateId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: LOCAL_UID,
      });
    }

    await notify(candidateId);
    return posters.length;
  }

  /**
   * 選んだポスターに、同じ内容をまとめて当てる。
   * 指定した項目だけを書き換える（触っていない項目は残す）。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @param {string[]} posterIds
   * @param {Record<string, *>} patch
   * @returns {Promise<number>} 書き換えた件数
   */
  async function updatePostersBulk(_uid, candidateId, posterIds, patch) {
    const all = await storage.getAll(POSTERS);
    const target = new Set(posterIds);

    for (const poster of all) {
      if (!target.has(poster.id)) continue;
      await storage.put(POSTERS, {
        ...poster,
        ...patch,
        updatedAt: Date.now(),
        updatedBy: LOCAL_UID,
      });
    }

    await notify(candidateId);
    return posterIds.length;
  }

  /**
   * 行ごとに違う内容を当てる。
   *
   * 貼替履歴のように「その行がいま何を持っているか」で書く内容が変わる更新は、
   * 共通の patch では表せないため、行ごとの差分を受け取る。
   *
   * @param {string} _uid
   * @param {string} candidateId
   * @param {{id: string, patch: Record<string, *>}[]} patches
   * @returns {Promise<number>} 書き換えた件数
   */
  async function updatePostersEach(_uid, candidateId, patches) {
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    const all = await storage.getAll(POSTERS);

    let count = 0;
    for (const poster of all) {
      const patch = byId.get(poster.id);
      if (patch === undefined) continue;
      await storage.put(POSTERS, {
        ...poster,
        ...patch,
        updatedAt: Date.now(),
        updatedBy: LOCAL_UID,
      });
      count += 1;
    }

    await notify(candidateId);
    return count;
  }

  return {
    listCandidates,
    createCandidate,
    renameCandidate,
    saveColumns,
    saveColumnVisibility: saveColumns,
    saveColorRules,
    archiveCandidate,
    restoreCandidate,
    deleteCandidateForever,
    countPosters,
    listPosters,
    watchPosters,
    createPoster,
    savePoster,
    deletePoster,
    createPostersBulk,
    updatePostersBulk,
    updatePostersEach,
  };
}

/**
 * 重複しないIDを作る。
 * @returns {string}
 */
function newId() {
  return crypto.randomUUID();
}
