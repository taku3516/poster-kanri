// 住所から緯度経度を求める。
//
// 国土地理院の住所検索APIを使う。無料・鍵不要で、日本の住所に強い。
// OpenStreetMap の Nominatim は「1秒1件・一括利用禁止」という規約があるため
// 台帳の一括処理には使えない。
//
// 同じ住所を二度問い合わせないよう、結果を控えておく。

import { parseAddress } from './address.js';

const ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

/**
 * 問い合わせ結果の控え。同じ住所は一度しか外に出さない。
 * @type {Map<string, GeocodeResult | null>}
 */
const cache = new Map();

/** 直前の問い合わせ時刻。相手先に負担をかけないよう間隔を空ける */
let lastCallAt = 0;

/** 問い合わせの最小間隔（ミリ秒） */
const MIN_INTERVAL = 200;

/**
 * @typedef {object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 * @property {string} normalized 正規化された住所
 * @property {string} district   地区（町字）
 * @property {string} areaDetail 詳細エリア（町丁目）
 */

/**
 * 指定したミリ秒だけ待つ。
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 住所から緯度経度と、そこから導いた地区・詳細エリアを求める。
 * 見つからなければ null を返す（例外にはしない）。
 *
 * @param {string} address
 * @returns {Promise<GeocodeResult | null>}
 */
export async function geocodeAddress(address) {
  const query = String(address ?? '').trim();
  if (query === '') return null;

  if (cache.has(query)) return cache.get(query) ?? null;

  const sinceLast = Date.now() - lastCallAt;
  if (sinceLast < MIN_INTERVAL) await wait(MIN_INTERVAL - sinceLast);
  lastCallAt = Date.now();

  let found = null;
  try {
    const response = await fetch(ENDPOINT + '?q=' + encodeURIComponent(query));
    if (response.ok) {
      const results = await response.json();
      if (Array.isArray(results) && results.length > 0) {
        const [lng, lat] = results[0].geometry.coordinates;
        const normalized = String(results[0].properties?.title ?? query);
        found = { lat, lng, normalized, ...parseAddress(normalized) };
      }
    }
  } catch {
    // 圏外や相手先の不調。見つからなかったものとして扱い、画面は止めない
    found = null;
  }

  cache.set(query, found);
  return found;
}

/**
 * 市区町村コードの対応表。必要になったときに一度だけ取り込む。
 * @type {Map<string, string> | null}
 */
let muniTable = null;

/**
 * 国土地理院の市区町村コード表を取り込む。
 *
 * 中身は `GSI.MUNI_ARRAY["13109"] = '13,東京都,13109,品川区';` という
 * JavaScript だが、実行はせず文字列として読み取る。
 * 外部から取ってきたコードを実行しないため。
 *
 * @returns {Promise<Map<string, string>>} コード → 「東京都品川区」
 */
async function loadMuniTable() {
  if (muniTable !== null) return muniTable;

  muniTable = new Map();
  try {
    const response = await fetch('https://maps.gsi.go.jp/js/muni.js');
    if (response.ok) {
      const text = await response.text();
      const pattern = /MUNI_ARRAY\["(\d+)"\]\s*=\s*'[^,]*,([^,]*),[^,]*,([^']*)'/g;
      for (const matched of text.matchAll(pattern)) {
        muniTable.set(matched[1], matched[2] + matched[3]);
      }
    }
  } catch {
    // 取れなくても致命ではない。市区町村名が付かないだけ
  }
  return muniTable;
}

/**
 * 座標から住所を求める（地図を押して新規追加するときに使う）。
 *
 * 国土地理院の逆ジオコーディングは町丁目までしか返さないため、
 * 番地は利用者に足してもらう前提とする。
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{address: string, district: string, areaDetail: string} | null>}
 */
export async function reverseGeocode(lat, lng) {
  const url = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
    + '?lat=' + lat + '&lon=' + lng;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const detail = String(data?.results?.lv01Nm ?? '');
    if (detail === '' || detail === '－') return null;

    const table = await loadMuniTable();
    const city = table.get(String(data?.results?.muniCd ?? '')) ?? '';

    // 「東京都品川区」＋「大井一丁目」。番地は利用者が足す
    const address = city + detail;

    return { address, ...parseAddress(address) };
  } catch {
    return null;
  }
}
