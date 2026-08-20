// CSV取り込みの計画づくり。
//
// 先に「何が起きるか」を組み立てて見せ、確定するまで一切書き込まない。
// 取り込みは元に戻せないため、押した後で気づくのでは遅い。
//
// Firestore に依存しない純粋な関数だけを置く。

import { orderedColumns, createEmptyPoster } from './schema.js';
import { parseValue } from './table.js';
import { fromCheckValue, HISTORY_PREFIX } from './csv.js';
import { fromDates, correctLatest } from './replacements.js';

/**
 * 取り込みの計画。
 * @typedef {object} ImportPlan
 * @property {{poster: object}[]} add 追加する行
 * @property {{id: string, poster: object, before: object}[]} update 更新する行
 * @property {{id: string, poster: object}[]} remove 削除する行
 * @property {string[]} unknownColumns 台帳に無い列
 * @property {string[]} duplicateNos CSVの中で重複した番号
 * @property {string[]} duplicateAddresses CSVの中で重複した掲示住所
 * @property {string[]} historyConflicts 貼替の列と最新貼替日が食い違った番号
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
    historyConflicts: [], errors: [], blocked: false,
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

  // 貼替履歴の列。CSVは入れ子を運べないため、履歴は 貼替1 貼替2 … に開いてある。
  // 台帳の列ではないので、通常の対応付けからは外す
  const historyIndexes = header
    .map((label, i) => ({ i, order: historyOrderOf(label) }))
    .filter((x) => x.order !== null)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.i);
  const isHistory = new Set(historyIndexes);

  // 見出しの各欄が、台帳のどの列に当たるか
  // 導出する列（貼替回数など）は書き込めない。見出しにあっても対応付けない
  const mapping = header.map((label, i) => {
    if (isHistory.has(i)) return null;
    const column = byLabel.get(label);
    return column === undefined || column.readOnly === true ? null : column;
  });
  plan.unknownColumns = header.filter(
    (label, i) => label !== '' && mapping[i] === null && !isHistory.has(i)
      && !byLabel.has(label),
  );

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

    if (historyIndexes.length > 0) {
      // 履歴の列があれば、そちらが本体。最新貼替日は履歴から導き直す
      const dates = historyIndexes
        .map((columnIndex) => String(row[columnIndex] ?? '').trim())
        .filter((text) => text !== '');

      const change = fromDates(dates);
      if (String(base.lastReplacedOn ?? '') !== String(change.lastReplacedOn ?? '')) {
        plan.historyConflicts.push(no);
      }
      Object.assign(base, change);
    } else {
      // 履歴を運んでいないCSVから「貼り替えがあった」とは判断できない。
      // 推測して足すと、Excel側での打ち直しまで実績として数えてしまう
      Object.assign(base, correctLatest(existing ?? {}, String(base.lastReplacedOn ?? '')));
    }

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

/**
 * 見出しが貼替履歴の列なら、その順番（1始まり）を返す。
 *
 * '貼替1' '貼替12' のように、語のうしろが数字だけのものを拾う。
 * '貼替日' のような別の意味の見出しは拾わない。
 *
 * @param {string} label
 * @returns {number | null}
 */
function historyOrderOf(label) {
  const text = String(label ?? '').trim();
  if (!text.startsWith(HISTORY_PREFIX)) return null;

  const rest = text.slice(HISTORY_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;

  const order = Number(rest);
  return order >= 1 ? order : null;
}
