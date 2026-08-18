// CSV取り込みの計画づくり。
//
// 先に「何が起きるか」を組み立てて見せ、確定するまで一切書き込まない。
// 取り込みは元に戻せないため、押した後で気づくのでは遅い。
//
// Firestore に依存しない純粋な関数だけを置く。

import { orderedColumns, createEmptyPoster } from './schema.js';
import { parseValue } from './table.js';
import { fromCheckValue } from './csv.js';

/**
 * 取り込みの計画。
 * @typedef {object} ImportPlan
 * @property {{poster: object}[]} add 追加する行
 * @property {{id: string, poster: object, before: object}[]} update 更新する行
 * @property {{id: string, poster: object}[]} remove 削除する行
 * @property {string[]} unknownColumns 台帳に無い列
 * @property {string[]} duplicateNos CSVの中で重複した番号
 * @property {string[]} duplicateAddresses CSVの中で重複した掲示住所
 * @property {string[]} errors 取り込めない理由
 * @property {boolean} blocked これが true なら取り込めない
 */

/**
 * CSVの行から取り込みの計画を組み立てる。
 *
 * @param {string[][]} rows 1行目が見出し
 * @param {Record<string, *>[]} posters いまの台帳
 * @param {import('./schema.js').Column[]} columns
 * @param {'merge' | 'replace'} mode
 * @returns {ImportPlan}
 */
export function buildImportPlan(rows, posters, columns, mode) {
  /** @type {ImportPlan} */
  const plan = {
    add: [], update: [], remove: [],
    unknownColumns: [], duplicateNos: [], duplicateAddresses: [],
    errors: [], blocked: false,
  };

  if (!Array.isArray(rows) || rows.length < 2) {
    plan.errors.push('中身のあるCSVを選んでください（見出しと1行以上のデータが要ります）。');
    plan.blocked = true;
    return plan;
  }

  const header = rows[0].map((h) => String(h ?? '').trim());
  const body = rows.slice(1);

  const all = orderedColumns(columns, { includeHidden: true });
  const byLabel = new Map(all.map((c) => [c.label, c]));

  // 見出しの各欄が、台帳のどの列に当たるか
  const mapping = header.map((label) => byLabel.get(label) ?? null);
  plan.unknownColumns = header.filter((label, i) => label !== '' && mapping[i] === null);

  const noIndex = header.indexOf('番号');
  if (noIndex === -1) {
    plan.errors.push('見出しに「番号」の列がありません。突合の鍵になるため必要です。');
    plan.blocked = true;
    return plan;
  }

  const byNo = new Map(
    posters.filter((p) => String(p.no ?? '').trim() !== '')
      .map((p) => [String(p.no).trim(), p]),
  );

  /** @type {Map<string, number>} */
  const seenNo = new Map();
  /** @type {Map<string, number>} */
  const seenAddress = new Map();
  const addressIndex = header.indexOf('掲示住所');

  const touched = new Set();

  body.forEach((row, i) => {
    const no = String(row[noIndex] ?? '').trim();

    if (no === '') {
      // 突合の鍵が無い。次回の更新で必ず二重登録になるため取り込まない
      plan.errors.push((i + 2) + '行目: 番号が空です。');
      return;
    }

    seenNo.set(no, (seenNo.get(no) ?? 0) + 1);

    if (addressIndex !== -1) {
      const address = String(row[addressIndex] ?? '').trim();
      if (address !== '') seenAddress.set(address, (seenAddress.get(address) ?? 0) + 1);
    }

    const existing = byNo.get(no);

    // 既存があればそれを土台にする。CSVに無い列の値を消さないため
    const base = existing === undefined
      ? { ...createEmptyPoster(columns), no }
      : { ...existing, custom: { ...(existing.custom ?? {}) } };

    header.forEach((label, columnIndex) => {
      const column = mapping[columnIndex];
      if (column === null) return;

      const raw = row[columnIndex];
      if (raw === undefined) return;

      const value = column.type === 'check'
        ? fromCheckValue(raw)
        : parseValue(raw, column.type);

      if (column.system) base[column.key] = value;
      else base.custom[column.key] = value;
    });

    if (existing === undefined) {
      plan.add.push({ poster: base });
    } else {
      touched.add(existing.id);
      plan.update.push({ id: existing.id, poster: base, before: existing });
    }
  });

  plan.duplicateNos = [...seenNo.entries()].filter(([, n]) => n > 1).map(([no]) => no);
  plan.duplicateAddresses = [...seenAddress.entries()]
    .filter(([, n]) => n > 1).map(([address]) => address);

  if (plan.duplicateNos.length > 0) {
    // どちらが正か機械には決められない。黙って片方を採らない
    plan.errors.push(
      'CSVの中で番号が重複しています: ' + plan.duplicateNos.join('、')
      + '。どちらを残すか決められないため取り込めません。',
    );
    plan.blocked = true;
  }

  if (mode === 'replace') {
    plan.remove = posters
      .filter((p) => !touched.has(p.id))
      .map((p) => ({ id: p.id, poster: p }));
  }

  if (plan.add.length === 0 && plan.update.length === 0 && plan.remove.length === 0) {
    if (plan.errors.length === 0) plan.errors.push('取り込む行がありませんでした。');
    plan.blocked = true;
  }

  return plan;
}
