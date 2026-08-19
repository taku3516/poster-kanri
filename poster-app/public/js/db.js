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
  onSnapshot,
  setDoc,
  writeBatch,
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
    colorRules: d.data().colorRules ?? [],
    activeRuleId: d.data().activeRuleId ?? '',
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

// ------------------------------------------------------------------ ポスター

/**
 * ある候補者のポスターを全件取り出す。
 *
 * 画面は watchPosters で受け取るので普段は使わないが、
 * 端末内保存（local-db.js）と関数の並びを揃えておく。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @returns {Promise<Record<string, *>[]>}
 */
export async function listPosters(uid, candidateId) {
  const snapshot = await getDocs(postersRef(uid, candidateId));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * ポスターの変化を見張る。端末をまたいだ同期はこれで実現している。
 *
 * onSnapshot は「取りに行く」のではなく「変わったら教えてもらう」形なので、
 * 事務所のパソコンで直した内容が、現地のスマホに自動で反映される。
 * オフライン中は手元の控えを返し、復帰時に差分が流れてくる。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {(posters: Record<string, *>[], sync: {fromCache: boolean, pending: boolean}) => void} onChange
 * @param {(error: Error) => void} onError
 * @returns {() => void} 見張りを止める関数
 */
export function watchPosters(uid, candidateId, onChange, onError) {
  return onSnapshot(
    postersRef(uid, candidateId),
    // 同期の状態だけが変わったときも知らせてもらう。
    // 「まだ送れていない変更がある」ことを画面に出すために要る
    { includeMetadataChanges: true },
    (snapshot) => {
      onChange(
        snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
        {
          fromCache: snapshot.metadata.fromCache,
          pending: snapshot.metadata.hasPendingWrites,
        },
      );
    },
    onError,
  );
}

/**
 * ポスターを1件足す。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {Record<string, *>} poster
 * @returns {Promise<string>} 作られたID
 */
export async function createPoster(uid, candidateId, poster) {
  const created = await addDoc(postersRef(uid, candidateId), {
    ...poster,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  return created.id;
}

/**
 * ポスターを丸ごと保存し直す。
 *
 * 差分更新ではなく置き換えにしているのは、列を消したときに
 * 古い値が Firestore 側に残り続けるのを避けるため。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {string} posterId
 * @param {Record<string, *>} poster
 * @returns {Promise<void>}
 */
export async function savePoster(uid, candidateId, posterId, poster) {
  const { id, createdAt, ...rest } = poster;
  await setDoc(doc(postersRef(uid, candidateId), posterId), {
    ...rest,
    // 置き換えなので、書かない項目は消える。
    // createdAt は「最初に登録した日」なので保存のたびに引き継ぐ
    ...(createdAt === undefined ? {} : { createdAt }),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }, { merge: false });
}

/**
 * ポスターを1件消す。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {string} posterId
 * @returns {Promise<void>}
 */
export async function deletePoster(uid, candidateId, posterId) {
  await deleteDoc(doc(postersRef(uid, candidateId), posterId));
}

/**
 * 列の表示・非表示を切り替えた列定義を保存する。
 * saveColumns と同じだが、呼び出し側の意図が読めるように別名にしている。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {import('./schema.js').Column[]} columns
 * @returns {Promise<void>}
 */
export const saveColumnVisibility = saveColumns;

/**
 * ポスターをまとめて足す。
 *
 * Firestore の一括書き込みは1回あたり500件までなので、
 * それを超える分は分けて送る。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {Record<string, *>[]} posters
 * @returns {Promise<number>} 足した件数
 */
export async function createPostersBulk(uid, candidateId, posters) {
  const LIMIT = 400; // 500の上限に対して余裕を持たせる
  const ref = postersRef(uid, candidateId);

  for (let start = 0; start < posters.length; start += LIMIT) {
    const batch = writeBatch(db);
    for (const poster of posters.slice(start, start + LIMIT)) {
      batch.set(doc(ref), {
        ...poster,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
    }
    await batch.commit();
  }

  return posters.length;
}

/**
 * 色分けルールと、いま選んでいるルールを保存する。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {object[]} colorRules
 * @param {string} activeRuleId 選んでいないときは空文字
 * @returns {Promise<void>}
 */
export async function saveColorRules(uid, candidateId, colorRules, activeRuleId) {
  await updateDoc(doc(candidatesRef(uid), candidateId), {
    colorRules,
    activeRuleId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 選んだポスターに、同じ内容をまとめて当てる。
 *
 * 丸ごと置き換えるのではなく、指定した項目だけを書き換える。
 * 一括操作で触っていない項目まで消えないようにするため。
 *
 * @param {string} uid
 * @param {string} candidateId
 * @param {string[]} posterIds
 * @param {Record<string, *>} patch 書き換える項目
 * @returns {Promise<number>} 書き換えた件数
 */
export async function updatePostersBulk(uid, candidateId, posterIds, patch) {
  const LIMIT = 400;
  const ref = postersRef(uid, candidateId);

  for (let start = 0; start < posterIds.length; start += LIMIT) {
    const batch = writeBatch(db);
    for (const posterId of posterIds.slice(start, start + LIMIT)) {
      batch.update(doc(ref, posterId), {
        ...patch,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
    }
    await batch.commit();
  }

  return posterIds.length;
}
