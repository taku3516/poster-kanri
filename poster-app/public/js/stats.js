// ダッシュボードの集計。
//
// 「今日」は引数で受け取る。関数の中で現在時刻を読むと、
// いつ実行したかで結果が変わり、検査ができなくなるため。
//
// Firestore に依存しない純粋な関数だけを置く。

/** ポスターの種別（枚数を持つ列） */
const TYPE_KEYS = ['size3L', 'size3S', 'size2L', 'size2S'];

/**
 * 「最後に手を入れた日」を返す。
 *
 * 貼替日が無い場合は掲示日を使う。一度も貼り替えていないなら、
 * 経過は「貼った日から」数えるのが実態に合う。
 *
 * @param {Record<string, *>} poster
 * @returns {string | null}
 */
export function lastRefreshedOn(poster) {
  const replaced = String(poster?.lastReplacedOn ?? '').trim();
  if (replaced !== '') return replaced;

  const posted = String(poster?.postedOn ?? '').trim();
  return posted === '' ? null : posted;
}

/**
 * その日から今日までの日数。
 * 日付は 'YYYY-MM-DD' の文字列。時刻を持たないため時差の影響を受けない。
 *
 * @param {string | null | undefined} dateText
 * @param {string} today 'YYYY-MM-DD'
 * @returns {number | null}
 */
export function daysSince(dateText, today) {
  const text = String(dateText ?? '').trim();
  if (text === '') return null;

  const from = Date.parse(text + 'T00:00:00Z');
  const to = Date.parse(String(today) + 'T00:00:00Z');
  if (Number.isNaN(from) || Number.isNaN(to)) return null;

  return Math.round((to - from) / 86400000);
}

/**
 * 撤去済かどうか。集計から外す対象。
 * @param {Record<string, *>} poster
 * @returns {boolean}
 */
function isRemoved(poster) {
  return poster?.status === '撤去済';
}

/**
 * 1件のポスターの合計枚数。
 * @param {Record<string, *>} poster
 * @returns {number}
 */
function sheetsOf(poster) {
  return TYPE_KEYS.reduce((sum, key) => sum + Number(poster?.[key] ?? 0), 0);
}

/**
 * 全体の集計。
 *
 * 撤去済は「今ある掲示場所」ではないため、件数・枚数から外す
 * （何件撤去したかは removed で別に返す）。
 *
 * @param {Record<string, *>[]} posters
 * @param {string} today
 * @returns {object}
 */
export function summarize(posters, today) {
  const active = posters.filter((p) => !isRemoved(p));

  /** @type {Record<string, number>} */
  const byType = { size3L: 0, size3S: 0, size2L: 0, size2S: 0 };
  let sheets = 0;
  let needLadder = 0;
  let plaDan = 0;
  let indoor = 0;
  let otherParty = 0;
  let onMap = 0;
  let noCoord = 0;
  let hiddenOnMap = 0;
  let overOneYear = 0;
  let unknownDate = 0;

  for (const poster of active) {
    for (const key of TYPE_KEYS) byType[key] += Number(poster[key] ?? 0);
    sheets += sheetsOf(poster);

    if (poster.needLadder === true) needLadder += 1;
    if (poster.plaDan === true) plaDan += 1;
    if (poster.indoor === true) indoor += 1;
    if (poster.otherParty === true) otherParty += 1;

    const hasCoord = typeof poster.lat === 'number' && typeof poster.lng === 'number';
    if (poster.showOnMap === false) hiddenOnMap += 1;
    else if (!hasCoord) noCoord += 1;
    else onMap += 1;

    const days = daysSince(lastRefreshedOn(poster), today);
    if (days === null) unknownDate += 1;
    else if (days >= 365) overOneYear += 1;
  }

  return {
    total: active.length,
    removed: posters.length - active.length,
    sheets,
    byType,
    needLadder,
    plaDan,
    indoor,
    otherParty,
    onMap,
    noCoord,
    hiddenOnMap,
    overOneYear,
    unknownDate,
  };
}

/**
 * 地区ごとの件数と枚数。多い順に並べる。
 *
 * @param {Record<string, *>[]} posters
 * @returns {{district: string, count: number, sheets: number}[]}
 */
export function byDistrict(posters) {
  /** @type {Map<string, {district: string, count: number, sheets: number}>} */
  const groups = new Map();

  for (const poster of posters.filter((p) => !isRemoved(p))) {
    const name = String(poster.district ?? '').trim() || '未設定';
    const row = groups.get(name) ?? { district: name, count: 0, sheets: 0 };
    row.count += 1;
    row.sheets += sheetsOf(poster);
    groups.set(name, row);
  }

  return [...groups.values()].sort((a, b) =>
    b.count - a.count || a.district.localeCompare(b.district, 'ja'));
}

/**
 * 貼替が古い順。次に回るべき場所を出す。
 *
 * 日付が全く無いものは最上位に置く。
 * 「古い」より「いつ貼ったか分からない」方が危ういため。
 *
 * @param {Record<string, *>[]} posters
 * @param {string} today
 * @param {number} limit
 * @returns {{poster: Record<string, *>, days: number | null}[]}
 */
export function stalest(posters, today, limit) {
  return posters
    .filter((p) => !isRemoved(p))
    .map((poster) => ({ poster, days: daysSince(lastRefreshedOn(poster), today) }))
    .sort((a, b) => {
      if (a.days === null && b.days === null) return 0;
      if (a.days === null) return -1; // 日付不明を先頭へ
      if (b.days === null) return 1;
      return b.days - a.days;          // 経過が長い順
    })
    .slice(0, limit);
}

/**
 * 経過期間の区切り。色分けの既定と同じ区切りにしてある。
 * 画面ごとに区切りが違うと、同じデータなのに件数が食い違って見えるため。
 */
const AGE_BUCKETS = Object.freeze([
  { upTo: 180, label: '半年以内' },
  { upTo: 365, label: '1年以内' },
  { upTo: 730, label: '2年以内' },
  { upTo: null, label: '2年超' },
]);

/**
 * 経過期間ごとの件数。古い方へ順に並べ、最後に日付なしを置く。
 *
 * 「1年以上◯件」という数だけでは貼替計画の山が読めない。
 * どこに固まっているかが分かると、いつ何件回るかを決められる。
 *
 * @param {Record<string, *>[]} posters
 * @param {string} today
 * @returns {{label: string, count: number, minDays: number|null}[]}
 */
export function ageDistribution(posters, today) {
  const rows = AGE_BUCKETS.map((bucket, index) => ({
    label: bucket.label,
    count: 0,
    // その区切り以上を一覧で絞り込むための下限
    minDays: index === 0 ? null : AGE_BUCKETS[index - 1].upTo,
  }));
  const unknown = { label: '日付なし', count: 0, minDays: null };

  for (const poster of posters.filter((p) => !isRemoved(p))) {
    const days = daysSince(lastRefreshedOn(poster), today);
    if (days === null) {
      unknown.count += 1;
      continue;
    }
    for (let i = 0; i < AGE_BUCKETS.length; i += 1) {
      const limit = AGE_BUCKETS[i].upTo;
      if (limit === null || days <= limit) {
        rows[i].count += 1;
        break;
      }
    }
  }

  return [...rows, unknown];
}

/**
 * 紹介者ごとの件数と枚数。多い順に並べる。
 *
 * 紹介が多い人ほど関係が濃い。お礼や次の依頼の優先順位に使う。
 * 紹介者が空のものは数えない。「未設定」が最上位に来ても読み取れる意味がないため。
 *
 * @param {Record<string, *>[]} posters
 * @returns {{introducer: string, count: number, sheets: number}[]}
 */
export function byIntroducer(posters) {
  /** @type {Map<string, {introducer: string, count: number, sheets: number}>} */
  const groups = new Map();

  for (const poster of posters.filter((p) => !isRemoved(p))) {
    const name = String(poster.introducer ?? '').trim();
    if (name === '') continue;

    const row = groups.get(name) ?? { introducer: name, count: 0, sheets: 0 };
    row.count += 1;
    row.sheets += sheetsOf(poster);
    groups.set(name, row);
  }

  return [...groups.values()].sort((a, b) =>
    b.count - a.count || b.sheets - a.sheets || a.introducer.localeCompare(b.introducer, 'ja'));
}
