// 台帳の列定義。
//
// 列は「固定項目」と「カスタム列」に分かれる。
//   固定項目 … 現行Excelの24項目＋地図と管理用。削除できない
//   カスタム列 … 利用者が自由に足せる。値は各ポスターの custom 配下に入る
//
// カスタム列のキーは c1 / c2 … という不変の記号にしている。
// 表示名（label）を変えてもキーが変わらないため、列名の変更で
// 全ポスターのデータを書き換える必要がない。
// 「表示名は変わるもの、識別子は変わらないもの」として分けている。
//
// Firestore に依存しない純粋なロジックだけを置く。

/**
 * 列の型。
 * @typedef {'text' | 'number' | 'date' | 'check' | 'select'} ColumnType
 */

/** @type {ColumnType[]} */
export const COLUMN_TYPES = ['text', 'number', 'date', 'check', 'select'];

/**
 * 列の定義。
 * @typedef {object} Column
 * @property {string} key      不変の識別子
 * @property {string} label    画面に出す名前
 * @property {ColumnType} type
 * @property {number} order    並び順
 * @property {boolean} visible 一覧に出すか
 * @property {boolean} system  固定項目なら true（削除できない）
 * @property {string} group    画面上のまとまり
 * @property {boolean} [readOnly] 直接は書けない列（保存せず導く値）
 * @property {*} [defaultValue] 型ごとの既定値と異なる場合だけ指定する
 */

/**
 * 固定項目。先頭24件は現行Excelの並びと一致させている。
 * @type {ReadonlyArray<Omit<Column, 'order'|'visible'>>}
 */
export const SYSTEM_COLUMNS = Object.freeze([
  // --- 現行Excelの24項目（この並びを変えないこと） ---
  { key: 'no',             label: '番号',       type: 'text',   system: true, group: '識別' },
  { key: 'postedOn',       label: '掲示日',     type: 'date',   system: true, group: '日付' },
  { key: 'lastReplacedOn', label: '最新貼替日', type: 'date',   system: true, group: '日付' },
  { key: 'introducer',     label: '紹介者',     type: 'text',   system: true, group: '人' },
  { key: 'owner',          label: '所有者',     type: 'text',   system: true, group: '人' },
  { key: 'phone',          label: '電話番号',   type: 'text',   system: true, group: '連絡先' },
  { key: 'mobile',         label: '携帯番号',   type: 'text',   system: true, group: '連絡先' },
  { key: 'email',          label: 'メール',     type: 'text',   system: true, group: '連絡先' },
  { key: 'contactAddress', label: '連絡先住所', type: 'text',   system: true, group: '連絡先' },
  { key: 'placeName',      label: '掲示場所',   type: 'text',   system: true, group: '場所' },
  { key: 'postalCode',     label: '郵便番号',   type: 'text',   system: true, group: '場所' },
  { key: 'address',        label: '掲示住所',   type: 'text',   system: true, group: '場所' },
  { key: 'district',       label: '地区',       type: 'select', system: true, group: '区分' },
  { key: 'areaDetail',     label: '詳細エリア', type: 'select', system: true, group: '区分' },
  { key: 'showOnMap',      label: 'マップ掲載', type: 'check',  system: true, group: '地図', defaultValue: true },
  { key: 'size3L',         label: '3連大',      type: 'number', system: true, group: '仕様' },
  { key: 'size3S',         label: '3連小',      type: 'number', system: true, group: '仕様' },
  { key: 'size2L',         label: '2連大',      type: 'number', system: true, group: '仕様' },
  { key: 'size2S',         label: '2連小',      type: 'number', system: true, group: '仕様' },
  { key: 'needLadder',     label: '要脚立',     type: 'check',  system: true, group: '条件' },
  { key: 'plaDan',         label: 'プラ段',     type: 'check',  system: true, group: '条件' },
  { key: 'indoor',         label: '室内',       type: 'check',  system: true, group: '条件' },
  { key: 'note',           label: '備考',       type: 'text',   system: true, group: 'その他' },
  { key: 'otherParty',     label: '他党',       type: 'check',  system: true, group: '条件' },

  // --- Excelには無いが台帳として必要なもの ---
  // 緯度経度の既定値は null。0 は大西洋上の実在する座標であり、
  // 「未設定」と区別できなくなるため 0 にはしない
  { key: 'lat',        label: '緯度',   type: 'number', system: true, group: '地図', defaultValue: null },
  { key: 'lng',        label: '経度',   type: 'number', system: true, group: '地図', defaultValue: null },
  // 手で動かした座標を、後のジオコーディング再実行で上書きさせないための印
  { key: 'coordFixed', label: '座標確定', type: 'check', system: true, group: '地図' },
  // 削除ではなく状態で持てば履歴が残る
  { key: 'status',     label: '状態',   type: 'select', system: true, group: '管理', defaultValue: '掲示中' },
  // 貼替履歴の件数。保存せず読むたびに数える（table.js）。
  // 二重に持つと、片方だけ古くなったときに食い違うため
  { key: 'replaceCount', label: '貼替回数', type: 'number', system: true, group: '日付', readOnly: true },
]);

/** CSVの先頭に置く24列。現行Excelの並びと一致させる。 */
export const CSV_COLUMN_KEYS = Object.freeze(
  SYSTEM_COLUMNS.slice(0, 24).map((c) => c.key),
);

/** 状態の選択肢 */
export const STATUS_OPTIONS = Object.freeze(['掲示中', '交渉中', '撤去済']);

/**
 * 型ごとの既定値。
 * @param {ColumnType} type
 * @returns {*}
 */
function defaultForType(type) {
  switch (type) {
    case 'number': return 0;
    case 'check': return false;
    case 'date': return null;
    default: return '';
  }
}

/**
 * 列の既定値を返す。列ごとの指定があればそちらを優先する。
 * @param {{type: ColumnType, defaultValue?: *}} column
 * @returns {*}
 */
function defaultForColumn(column) {
  return 'defaultValue' in column ? column.defaultValue : defaultForType(column.type);
}

/**
 * 候補者を新しく作ったときの列定義を返す。
 * @returns {Column[]}
 */
export function defaultColumns() {
  return SYSTEM_COLUMNS.map((c, i) => ({ ...c, order: i, visible: true }));
}

/**
 * 保存済みの列定義に、後から増えた固定項目を足して返す。
 *
 * 列定義は候補者ごとに保存されるため、`SYSTEM_COLUMNS` に項目を足しても
 * 既にある台帳には現れない。読むときにここで補う。
 *
 * 既にある列には触らない。利用者が変えた表示名・並び・表示/非表示を
 * 上書きしないため。足す列は末尾に置く。
 *
 * @param {Column[]} columns
 * @returns {Column[]}
 */
export function withSystemColumns(columns) {
  const list = Array.isArray(columns) ? columns : [];
  const known = new Set(list.map((c) => c.key));

  let order = list.reduce((m, c) => Math.max(m, c.order ?? 0), -1);
  const missing = SYSTEM_COLUMNS
    .filter((c) => !known.has(c.key))
    .map((c) => {
      order += 1;
      return { ...c, order, visible: true };
    });

  return missing.length === 0 ? list : [...list, ...missing];
}

/**
 * 次に使えるカスタム列のキーを返す。
 * 既に使われている番号の最大値の次を使う（削除した番号は再利用しない）。
 * 再利用すると、古いデータに残った値が別の列の値として現れてしまう。
 *
 * @param {Column[]} columns
 * @returns {string} 'c1' 'c2' …
 */
export function nextCustomKey(columns) {
  let max = 0;
  for (const column of columns) {
    const matched = /^c(\d+)$/.exec(column.key);
    if (matched !== null) max = Math.max(max, Number(matched[1]));
  }
  return 'c' + (max + 1);
}

/**
 * カスタム列を足した新しい配列を返す（元の配列は変えない）。
 *
 * @param {Column[]} columns
 * @param {{label: string, type: ColumnType}} spec
 * @returns {Column[]}
 * @throws {Error} 列名が空、または知らない型のとき
 */
export function addCustomColumn(columns, spec) {
  const label = String(spec?.label ?? '').trim();
  const type = spec?.type;

  if (label === '') throw new Error('列名を入力してください');
  if (!COLUMN_TYPES.includes(type)) throw new Error('知らない列の型です: ' + type);

  const maxOrder = columns.reduce((m, c) => Math.max(m, c.order), -1);

  return [
    ...columns,
    {
      key: nextCustomKey(columns),
      label,
      type,
      order: maxOrder + 1,
      visible: true,
      system: false,
      group: '追加',
    },
  ];
}

/**
 * 列を消した新しい配列を返す。固定項目は消せない。
 *
 * @param {Column[]} columns
 * @param {string} key
 * @returns {Column[]}
 * @throws {Error} 固定項目を消そうとしたとき
 */
export function removeColumn(columns, key) {
  const target = columns.find((c) => c.key === key);
  if (target === undefined) throw new Error('その列はありません: ' + key);
  if (target.system) throw new Error('固定項目は削除できません: ' + target.label);

  return columns.filter((c) => c.key !== key);
}

/**
 * 列の表示名を変えた新しい配列を返す。キーは変えないため、
 * 各ポスターのデータを書き換える必要がない。
 *
 * @param {Column[]} columns
 * @param {string} key
 * @param {string} label
 * @returns {Column[]}
 * @throws {Error} 列名が空のとき
 */
export function renameColumn(columns, key, label) {
  const trimmed = String(label ?? '').trim();
  if (trimmed === '') throw new Error('列名を入力してください');
  if (!columns.some((c) => c.key === key)) throw new Error('その列はありません: ' + key);

  return columns.map((c) => (c.key === key ? { ...c, label: trimmed } : c));
}

/**
 * 一覧に出す列を、並び順に整えて返す。
 *
 * @param {Column[]} columns
 * @param {{includeHidden?: boolean}} [options]
 * @returns {Column[]}
 */
export function orderedColumns(columns, options = {}) {
  const includeHidden = options.includeHidden === true;
  return columns
    .filter((c) => includeHidden || c.visible !== false)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/**
 * 新しいポスターの初期値を作る。
 * 固定項目は直下に、カスタム列は custom 配下に置く。
 *
 * @param {Column[]} columns
 * @returns {Record<string, *>}
 */
export function createEmptyPoster(columns) {
  /** @type {Record<string, *>} */
  const poster = { custom: {} };

  for (const column of columns) {
    // 導出する列は保存しない
    if (column.readOnly === true) continue;
    if (column.system) {
      poster[column.key] = defaultForColumn(column);
    } else {
      poster.custom[column.key] = defaultForColumn(column);
    }
  }

  return poster;
}
