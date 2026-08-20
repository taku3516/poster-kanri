// 貼替の履歴。
//
// 従来は「最新貼替日」の1つしか持っていなかった。これだと貼り替えるたびに
// 前回の記録が消えるため、月別の貼替実績が時間とともに書き換わっていた
// （過去の月の棒が、貼り替えるたびに減っていく）。
//
// そこで履歴 replacements[] を持ち、lastReplacedOn は
// 「履歴の最後」として保存し続ける。lastReplacedOn を残すのは、
// CSVの24列・絞り込み・色分け・表の並べ替えがこの項目を読んでいるため。
// 導出値だが保存することで、読む側は一切変えずに済む。
//
// **既存データの書き換えは行わない。** replacements を持たないポスターは
// 「lastReplacedOn が1件だけの履歴」として読むときに落とす。
// 途中で止まっても壊れるものがない。
//
// Firestore に依存しない純粋な関数だけを置く。

/**
 * 履歴と、そこから導いた最新貼替日。書き込む差分の形。
 * @typedef {object} ReplacementChange
 * @property {string[]} replacements   昇順・重複なしの 'YYYY-MM-DD'
 * @property {string | null} lastReplacedOn 履歴の最後。空なら null
 */

/**
 * 'YYYY-MM-DD' として読める日付か。
 *
 * 形だけでなく実在する日かも見る。'2025-02-30' は形は合うが日付ではない。
 * CSVから来る「不明」「2025年」「2025/05/05」はここで落ちる。
 *
 * @param {*} value
 * @returns {boolean}
 */
function isDateText(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;

  const time = Date.parse(text + 'T00:00:00Z');
  if (Number.isNaN(time)) return false;

  // 桁あふれ（2025-02-30 → 3月2日）を弾く。戻した文字列が一致するかで見る
  return new Date(time).toISOString().slice(0, 10) === text;
}

/**
 * 日付の並びを昇順・重複なしに整える。読めない値は捨てる。
 *
 * @param {*} list
 * @returns {string[]}
 */
function tidy(list) {
  const dates = (Array.isArray(list) ? list : [])
    .map((v) => String(v ?? '').trim())
    .filter(isDateText);

  return [...new Set(dates)].sort();
}

/**
 * そのポスターの貼替履歴を返す。
 *
 * 履歴を持たない（あるいは空の）ポスターは、lastReplacedOn を1件として扱う。
 * これにより移行処理なしで既存データを読める。
 *
 * @param {Record<string, *> | null | undefined} poster
 * @returns {string[]} 昇順・重複なし
 */
export function historyOf(poster) {
  const history = tidy(poster?.replacements);
  if (history.length > 0) return history;

  return tidy([poster?.lastReplacedOn]);
}

/**
 * 履歴から書き込む差分を組み立てる。
 * @param {string[]} history
 * @returns {ReplacementChange}
 */
function toChange(history) {
  const tidied = tidy(history);
  return {
    replacements: tidied,
    lastReplacedOn: tidied.length === 0 ? null : tidied[tidied.length - 1],
  };
}

/**
 * 貼替を1件足す。
 *
 * 同じ日を二度足しても増えない（現地で「今日にする」を二度押しても
 * 実績が二重にならないようにするため）。
 * 最新より古い日を足した場合、履歴には入るが最新貼替日は下がらない。
 *
 * @param {Record<string, *>} poster
 * @param {string} date 'YYYY-MM-DD'
 * @returns {ReplacementChange | null} 変わらない場合と、日付が読めない場合は null
 */
export function addReplacement(poster, date) {
  const text = String(date ?? '').trim();
  if (!isDateText(text)) return null;

  return toChange([...historyOf(poster), text]);
}

/**
 * 貼替を1件取り消す。押し間違いを直すために使う。
 *
 * 取り消すと最新貼替日は前の回に戻る。
 *
 * @param {Record<string, *>} poster
 * @param {string} date 'YYYY-MM-DD'
 * @returns {ReplacementChange | null} 履歴に無い日なら null
 */
export function removeReplacement(poster, date) {
  const text = String(date ?? '').trim();
  const history = historyOf(poster);
  if (!history.includes(text)) return null;

  return toChange(history.filter((d) => d !== text));
}

/**
 * 最新の1件を訂正する。**履歴の件数は増えない。**
 *
 * 「貼り替えた」のではなく「入力を間違えた」場合に使う。
 * 足す操作と分けているのは、間違いを直すたびに実績が増えると
 * 月別の貼替実績が実態より多く出てしまうため。
 *
 * 空文字を渡すと最新の1件が消える。
 *
 * @param {Record<string, *>} poster
 * @param {string} date 'YYYY-MM-DD'。空なら最新の1件を消す
 * @returns {ReplacementChange} 常に差分を返す
 */
export function correctLatest(poster, date) {
  const text = String(date ?? '').trim();
  const rest = historyOf(poster).slice(0, -1);

  return toChange(isDateText(text) ? [...rest, text] : rest);
}

/**
 * 日付の並びから、そのまま履歴を組み立てる。
 *
 * CSVの「貼替1 貼替2 …」の欄を読んだときに使う。
 * 並び順・重複・空欄・読めない値の始末はここで引き受ける。
 *
 * @param {*} dates
 * @returns {ReplacementChange}
 */
export function fromDates(dates) {
  return toChange(Array.isArray(dates) ? dates : []);
}
