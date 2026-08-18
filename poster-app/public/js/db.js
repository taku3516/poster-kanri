// Firestore とのやり取り。
//
// データの形（個人別台帳型）:
//   users/{uid}/candidates/{candidateId}          … 候補者＝台帳
//   users/{uid}/candidates/{candidateId}/posters  … ポスター掲示場所
//
// users/{uid} 配下は本人しか読み書きできない（firestore.rules）。
// データの入れ子そのものがアクセス境界になっているため、
// 「他人のデータが見える」不具合が構造上起こらない。

import { getApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';

import { defaultColumns } from './schema.js';

// 電波の届かない場所でも閲覧・編集できるようにする。
// 現地でポスターを確認しながら使う道具なので、通信前提にはしない。
const db = initializeFirestore(getApp(), {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

/**
 * 候補者。
 * @typedef {object} Candidate
 * @property {string} id
 * @property {string} name
 * @property {boolean} archived 保管済み（一覧に出さない）
 * @property {import('./schema.js').Column[]} columns
 */

/**
 * その利用者の候補者コレクションを指す。
 * @param {string} uid
 * @returns {import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js').CollectionReference}
 */
function candidatesRef(uid) {
  return collection(db, 'users', uid, 'candidates');
}

/**
 * ある候補者のポスターコレクションを指す。
 * @param {string} uid
 * @param {string} candidateId
 * @returns {import('https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js').CollectionReference}
 */
export function postersRef(uid, candidateId) {
  return collection(db, 'users', uid, 'candidates', candidateId, 'posters');
}

/**
 * 候補者の一覧を取り出す。保管済みは既定で除く。
 *
 * @param {string} uid
 * @param {{includeArchived?: boolean}} [options]
 * @returns {Promise<Candidate[]>}
 */
export async function listCandidates(uid, options = {}) {
  const snapshot = await getDocs(query(candidatesRef(uid), orderBy('name')));

  /** @type {Candidate[]} */
  const all = snapshot.docs.map((d) => ({
    id: d.id,
    name: d.data().name ?? '(名称未設定)',
    archived: d.data().archived === true,
    columns: d.data().columns ?? defaultColumns(),
  }));

  return options.includeArchived === true ? all : all.filter((c) => !c.archived);
}

/**
 * 候補者を新しく作る。列定義は既定のものを持たせる。
 *
 * @param {string} uid
 * @param {string} name
 * @returns {Promise<string>} 作られた候補者のID
 * @throws {Error} 名前が空のとき
 */
export async function createCandidate(uid, name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') throw new Error('候補者名を入力してください');

  const created = await addDoc(candidatesRef(uid), {
    name: trimmed,
    archived: false,
    columns: defaultColumns(),
    colorRules: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return created.id;
}

/**
 * 候補者の名前を変える。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {string} name
 * @returns {Promise<void>}
 * @throws {Error} 名前が空のとき
 */
export async function renameCandidate(uid, candidateId, name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') throw new Error('候補者名を入力してください');

  await updateDoc(doc(candidatesRef(uid), candidateId), {
    name: trimmed,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 候補者の列定義を保存する。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {import('./schema.js').Column[]} columns
 * @returns {Promise<void>}
 */
export async function saveColumns(uid, candidateId, columns) {
  await updateDoc(doc(candidatesRef(uid), candidateId), {
    columns,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 候補者を「保管」する（一覧から外すが消さない）。
 *
 * Firestore は入れ子のコレクションを一緒に消さないため、
 * 候補者だけを消すとポスターが取り出せないまま残り続ける。
 * 現状は消さずに印を付ける方式にしている。
 * → 完全削除の扱いは docs/requirements.md の検討事項。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @returns {Promise<void>}
 */
export async function archiveCandidate(uid, candidateId) {
  await updateDoc(doc(candidatesRef(uid), candidateId), {
    archived: true,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 保管した候補者を元に戻す。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @returns {Promise<void>}
 */
export async function restoreCandidate(uid, candidateId) {
  await updateDoc(doc(candidatesRef(uid), candidateId), {
    archived: false,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 候補者とそのポスターを完全に削除する。取り消せない。
 *
 * 入れ子のポスターを先に消してから候補者を消す。
 * 逆順にすると、候補者が消えた時点でポスターへの経路が失われ、
 * 取り出せないデータが残り続ける。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @returns {Promise<number>} 消したポスターの件数
 */
export async function deleteCandidateForever(uid, candidateId) {
  const posters = await getDocs(postersRef(uid, candidateId));

  await Promise.all(posters.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(candidatesRef(uid), candidateId));

  return posters.size;
}

/**
 * ある候補者のポスター件数を数える。
 * 全件を読まずに数だけ取るため、通信量が少なく済む。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @returns {Promise<number>}
 */
export async function countPosters(uid, candidateId) {
  const snapshot = await getCountFromServer(postersRef(uid, candidateId));
  return snapshot.data().count;
}
