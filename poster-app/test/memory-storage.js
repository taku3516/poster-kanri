// テスト用の保存先。IndexedDB の代わりにメモリ上の Map を使う。
//
// local-db.js は「保存の入れ物」を外から受け取る形にしてある。
// そのおかげで、Node に IndexedDB が無くても保存層の全ての振る舞いを
// テストできる（依存パッケージを足さずに済む）。

/**
 * メモリ上の保存先を作る。
 * @returns {import('../public/js/local-db.js').LocalStorageAdapter}
 */
export function createMemoryStorage() {
  /** @type {Map<string, Map<string, Record<string, *>>>} */
  const stores = new Map();

  /** @param {string} name @returns {Map<string, Record<string, *>>} */
  function storeOf(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return /** @type {Map<string, Record<string, *>>} */ (stores.get(name));
  }

  return {
    async getAll(name) {
      // 実物と同じく、取り出した値は控えの複製にする。
      // 呼び出し側が受け取った値を書き換えても保存先が変わらないようにするため
      return [...storeOf(name).values()].map((v) => structuredClone(v));
    },
    async put(name, value) {
      storeOf(name).set(String(value.id), structuredClone(value));
    },
    async remove(name, id) {
      storeOf(name).delete(String(id));
    },
  };
}
