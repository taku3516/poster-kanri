// 現在地からの距離。
//
// 現地で「次はどこ」を出すために使う。
// 地球を球とみなす計算（ヒュベニの式ではなく大圏距離）で、
// 数キロの範囲なら誤差は実用上問題にならない。
//
// Firestore に依存しない純粋な関数だけを置く。

/** 地球の半径（メートル） */
const EARTH_RADIUS = 6371000;

/**
 * @typedef {{lat: number, lng: number}} Point
 */

/**
 * 度を弧度に変える。
 * @param {number} degrees
 * @returns {number}
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * 2地点の距離（メートル）。
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function distanceMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 距離を読みやすい文字にする。
 * 1km 未満はメートル、それ以上はキロメートルで小数第1位まで。
 *
 * @param {number | null} meters
 * @returns {string}
 */
export function formatDistance(meters) {
  if (meters === null || meters === undefined || Number.isNaN(Number(meters))) return '';
  const value = Number(meters);
  if (value < 1000) return Math.round(value) + ' m';

  // toFixed は浮動小数点の都合で 1.45 が 1.4 になることがある。
  // 表示の丸め方が値によって変わらないよう、明示的に四捨五入する
  const tenths = Math.round(value / 100);
  return (tenths / 10).toFixed(1) + ' km';
}

/**
 * そのポスターの座標を返す。無ければ null。
 * @param {Record<string, *>} poster
 * @returns {Point | null}
 */
function pointOf(poster) {
  return typeof poster?.lat === 'number' && typeof poster?.lng === 'number'
    ? { lat: poster.lat, lng: poster.lng }
    : null;
}

/**
 * 現在地からの距離（メートル）。座標が無ければ null。
 * @param {Record<string, *>} poster
 * @param {Point | null} here
 * @returns {number | null}
 */
export function distanceOf(poster, here) {
  if (here === null) return null;
  const point = pointOf(poster);
  return point === null ? null : distanceMeters(here, point);
}

/**
 * 近い順に並べた新しい配列を返す。
 * 座標が無いものは最後に置く（距離が比べられないため）。
 *
 * @param {Record<string, *>[]} posters
 * @param {Point | null} here
 * @returns {Record<string, *>[]}
 */
export function sortByDistance(posters, here) {
  if (here === null) return posters.slice();

  return posters.slice().sort((left, right) => {
    const a = distanceOf(left, here);
    const b = distanceOf(right, here);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
}

/**
 * 指定した距離の中にあるものだけを返す。
 * 現在地が分からないときは絞り込まない（何も出ないより全部出す方がよい）。
 *
 * @param {Record<string, *>[]} posters
 * @param {Point | null} here
 * @param {number} meters
 * @returns {Record<string, *>[]}
 */
export function withinMeters(posters, here, meters) {
  if (here === null) return posters.slice();
  return posters.filter((poster) => {
    const distance = distanceOf(poster, here);
    return distance !== null && distance <= meters;
  });
}
