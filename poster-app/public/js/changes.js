// 未保存の変更があるかの判定。
//
// 編集を閉じるときに確認を出すために使う。
// 何を比較対象から外すかが要点で、updatedAt のような管理用の項目まで
// 比べると、開いて閉じただけで「変更あり」になり警告が形骸化する。
//
// Firestore に依存しない純粋な関数だけを置く。

import { createEmptyPoster } from './schema.js';
import { posterValue } from './table.js';

/**
 * 比較しない項目。データそのものではなく、記録の管理に使うもの。
 * @type {ReadonlySet<string>}
 */
const IGNORED = new Set(['id', 'createdAt', 'updatedAt', 'updatedBy']);

/**
 * 2つの値が同じとみなせるか。
 * 未設定の表し方（null / undefined / 空文字）の違いは無視する。
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function sameValue(a, b) {
  const blank = (v) => v === null || v === undefined || v === '';
  if (blank(a) && blank(b)) return true;
  // 数値の 0 とチェックの false は未設定ではないので、そのまま比べる
  return a === b;
}

/**
 * 未保存の変更があるか。
 *
 * @param {Record<string, *> | null} original 編集前。新規なら null
 * @param {Record<string, *>} draft 編集中の内容
 * @param {import('./schema.js').Column[]} columns
 * @returns {boolean}
 */
export function hasChanges(original, draft, columns) {
  // 新規は「空の状態」と比べる。
  // 番号は自動で入るため、それだけでは入力したとみなさない
  const base = original === null
    ? { ...createEmptyPoster(columns), no: draft?.no }
    : original;

  for (const column of columns) {
    if (IGNORED.has(column.key)) continue;
    if (!sameValue(posterValue(base, column), posterValue(draft, column))) return true;
  }

  // 新規で番号を手で変えた場合を拾う
  if (original === null) {
    const empty = createEmptyPoster(columns);
    const auto = /^\d+$/.test(String(draft?.no ?? ''));
    if (!auto && String(draft?.no ?? '') !== String(empty.no ?? '')) return true;
  }

  return false;
}
