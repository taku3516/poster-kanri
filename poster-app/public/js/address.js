// 住所から地区（町字）と詳細エリア（町丁目）を切り出す。
//
// 入力は「国土地理院APIが返す正規化済みの住所」を想定している。
// 利用者が入力した生の住所は表記が揺れる（大井1-2-3 / 大井一丁目2番3号）が、
// 正規化結果は形が揃っているため、機械的に切り出せる。
//
// 町丁目の一覧はアプリに持たない。手書きの一覧は誤りと改称漏れが起きるが、
// 正規化済み住所からの切り出しなら常に実データと一致する。
//
// 通信は行わない純粋な関数だけを置く。

/** @type {readonly string[]} 1〜9の漢数字 */
const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 全角の数字を半角にする。
 * @param {string} text
 * @returns {string}
 */
export function toHalfWidthDigits(text) {
  return String(text ?? '').replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 数を漢数字にする。丁目に使うため 1〜99 を対象とする。
 * @param {number} value
 * @returns {string}
 */
export function toKanjiNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(value);

  if (n < 10) return KANJI_DIGITS[n];

  const tens = Math.floor(n / 10);
  const ones = n % 10;
  // 十 / 十一 / 二十 / 二十三 の形
  return (tens === 1 ? '' : KANJI_DIGITS[tens]) + '十' + KANJI_DIGITS[ones];
}

/**
 * 丁目の番号を漢数字に揃える。
 * 表記が揺れると同じ町丁目が別物として集計されるため。
 * @param {string} chome 漢数字または算用数字
 * @returns {string}
 */
function normalizeChome(chome) {
  return /^\d+$/.test(chome) ? toKanjiNumber(Number(chome)) : chome;
}

/**
 * 住所から地区と詳細エリアを取り出す。
 *
 * - 品川区内 … 地区＝町字、詳細エリア＝町丁目
 * - 品川区外 … 地区＝「区外」、詳細エリア＝市区町村名
 * - 読み取れない … どちらも空（誤った値で埋めない）
 *
 * @param {string | null | undefined} address
 * @returns {{district: string, areaDetail: string}}
 */
export function parseAddress(address) {
  const text = toHalfWidthDigits(String(address ?? '')).trim();
  if (text === '') return { district: '', areaDetail: '' };

  const shinagawa = text.indexOf('品川区');
  if (shinagawa !== -1) {
    const rest = text.slice(shinagawa + '品川区'.length);

    // 丁目がある場合だけ丁目として扱う。
    // 東八潮のように丁目を持たない町では、正規化結果も「１番」であり
    // 「丁目」が現れない。ここで数字から丁目を作ると存在しない町丁目が生まれる
    const withChome = /^([^0-9]+?)([一二三四五六七八九十]+|[0-9]+)丁目/.exec(rest);
    if (withChome !== null) {
      const town = withChome[1];
      return {
        district: town,
        areaDetail: town + normalizeChome(withChome[2]) + '丁目',
      };
    }

    // 丁目が無い町。数字や「番」の手前までが町名
    const townOnly = /^([^0-9]+?)(?=[0-9]|番|$)/.exec(rest);
    if (townOnly !== null && townOnly[1] !== '') {
      return { district: townOnly[1], areaDetail: townOnly[1] };
    }

    return { district: '', areaDetail: '' };
  }

  // 品川区以外。都道府県を除いた先頭の市区町村を拾う
  const withoutPrefecture = text.replace(/^.+?[都道府県]/, '');
  const city = /^(.+?[市区町村])/.exec(withoutPrefecture);
  if (city !== null) {
    return { district: '区外', areaDetail: city[1] };
  }

  return { district: '', areaDetail: '' };
}
