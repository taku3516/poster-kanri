// IndexedDB の薄い包み。local-db.js に「保存の入れ物」を渡すためだけのもの。
//
// ここには判断を置かない。値を出し入れするだけに留めてある。
// 判断を local-db.js 側に集めておけば、そちらは Node 上でテストできるため。
//
// localStorage ではなく IndexedDB を使う理由:
//   localStorage の上限は 5MB 程度で、1000件規模の台帳を複数持つと届かない。
//   また localStorage は同期的に動くため、書き込みのたびに画面が止まる。

const DB_NAME = 'poster-app';
const DB_VERSION = 1;
const STORES = ['candidates', 'posters'];

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/**
 * IndexedDB を開く。二重に開かないよう、一度目の約束を使い回す。
 *
 * @returns {Promise<IDBDatabase>}
 * @throws {Error} この端末で IndexedDB が使えないとき
 */
function openDb() {
  if (opening !== null) return opening;

  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('この端末（またはブラウザの設定）では端末内に保存できません。'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      reject(new Error(
        '端末内の保存領域を開けませんでした。'
        + 'プライベートブラウズ中や、保存容量が不足している場合に起こります。'
        + '（' + String(request.error?.message ?? '原因不明') + '）',
      ));
    };

    // 別のタブが古い版を開いたまま塞いでいる場合。
    // 黙って待ち続けると「読み込み中」のまま止まって見えるため知らせる
    request.onblocked = () => {
      reject(new Error('別のタブでこのアプリが開かれています。他のタブを閉じてから開き直してください。'));
    };
  });

  // 失敗したら次の呼び出しでやり直せるようにする
  opening.catch(() => { opening = null; });

  return opening;
}

/**
 * ひとつの操作を実行する。
 *
 * @template T
 * @param {string} store 対象のストア名
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @returns {Promise<T>}
 */
async function perform(store, mode, run) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toError(request.error));
    transaction.onabort = () => reject(toError(transaction.error));
  });
}

/**
 * IndexedDB の保存先を作る。
 * @returns {import('./local-db.js').LocalStorageAdapter}
 */
export function createIdbStorage() {
  return {
    getAll(name) {
      return perform(name, 'readonly', (store) => store.getAll());
    },
    async put(name, value) {
      await perform(name, 'readwrite', (store) => store.put(value));
    },
    async remove(name, id) {
      await perform(name, 'readwrite', (store) => store.delete(String(id)));
    },
  };
}

/**
 * 端末内に保存されたものを全て消す。
 * 取り込みが済んだ後の後片付けに使う。
 *
 * @returns {Promise<void>}
 */
export async function clearLocalData() {
  for (const name of STORES) {
    await perform(name, 'readwrite', (store) => store.clear());
  }
}

/**
 * DOMException を、原因の分かる Error に変える。
 *
 * @param {DOMException | null} error
 * @returns {Error}
 */
function toError(error) {
  if (error?.name === 'QuotaExceededError') {
    return new Error('端末の保存容量が足りません。不要なデータを整理してからお試しください。');
  }
  return new Error('端末内への保存に失敗しました（' + String(error?.message ?? '原因不明') + '）。');
}
