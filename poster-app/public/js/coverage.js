// 人口あたりのカバー率。
//
// 「地区別の件数」だけでは戦略の材料にならない。大きい町は多くて当たり前で、
// 順位を見ても手薄かどうかは判断できない。分母（人口・有権者数）を入れて
// はじめて「人口の割に少ない地区」が分かる。
//
// もう一つの要点は、ポスターが1枚も無い地区も並べること。
// 件数の集計だけだと0件の地区はそもそも現れず、
// 最も手薄な場所が画面から消えてしまう。
//
// Firestore に依存しない純粋な関数だけを置く。

/** 分母の選び方 */
export const BASIS = Object.freeze({
  /** 18歳以上。ポスターの用途ではこちらが実態に近い */
  voters: 'voters',
  /** 総人口 */
  population: 'population',
});

/** ポスターの種別（枚数を持つ列） */
const TYPE_KEYS = ['size3L', 'size3S', 'size2L', 'size2S'];

/**
 * 1件の合計枚数。
 * @param {Record<string, *>} poster
 * @returns {number}
 */
function sheetsOf(poster) {
  return TYPE_KEYS.reduce((sum, key) => sum + Number(poster?.[key] ?? 0), 0);
}

/**
 * 地区ごとの、人口あたりの掲示枚数。
 *
 * 手薄な順（率の小さい順）に並べる。次に行くべき場所が上に来る。
 * 人口表に無い地区（区外・未設定）は分母が無いため対象から外し、
 * その件数を excluded として返す。
 *
 * @param {Record<string, *>[]} posters
 * @param {Record<string, [number, number]>} populationTable 町字 → [人口, 18歳以上]
 * @param {'voters' | 'population'} basis
 * @param {number} [minPeople] これ未満の地区は順位から外す。0で無効
 * @returns {{district: string, count: number, sheets: number, people: number,
 *            per10k: number | null}[] & {excluded: number, smallPopulation: object[]}}
 */
export function coverageByTown(posters, populationTable, basis, minPeople = 0) {
  const index = basis === BASIS.population ? 0 : 1;

  /** @type {Map<string, {count: number, sheets: number}>} */
  const tally = new Map();
  let excluded = 0;

  for (const poster of posters) {
    if (poster?.status === '撤去済') continue;

    const name = String(poster?.district ?? '').trim();
    if (!Object.hasOwn(populationTable, name)) {
      excluded += 1;
      continue;
    }

    const row = tally.get(name) ?? { count: 0, sheets: 0 };
    row.count += 1;
    row.sheets += sheetsOf(poster);
    tally.set(name, row);
  }

  // 掲示が無い地区も必ず並べる
  const rows = Object.entries(populationTable).map(([district, values]) => {
    const people = Number(values?.[index] ?? 0);
    const found = tally.get(district) ?? { count: 0, sheets: 0 };
    return {
      district,
      count: found.count,
      sheets: found.sheets,
      people,
      // 人口が0の地区では率を出さない（0で割らない）
      per10k: people > 0 ? (found.sheets / people) * 10000 : null,
    };
  });

  // 分母が小さすぎる地区は率が跳ねて順位が実態を表さない。
  // 1枚の増減で大きく動き、外れ値として他の地区の棒も潰してしまう
  const smallPopulation = minPeople > 0
    ? rows.filter((row) => row.people < minPeople)
    : [];
  const ranked = minPeople > 0
    ? rows.filter((row) => row.people >= minPeople)
    : rows;

  ranked.sort((a, b) => {
    // 率が出せない地区は最後に置く
    if (a.per10k === null && b.per10k === null) return 0;
    if (a.per10k === null) return 1;
    if (b.per10k === null) return -1;
    return a.per10k - b.per10k || b.people - a.people;
  });

  // 対象外の件数と、分母が小さくて外した地区を添えて返す
  return Object.assign(ranked, { excluded, smallPopulation });
}

/**
 * 率を表示用の文字にする。
 * @param {number | null} value
 * @returns {string}
 */
export function formatPer10k(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return (Math.round(Number(value) * 10) / 10).toFixed(1);
}
