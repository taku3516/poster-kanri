// 外部へ共有する内容の組み立て。
//
// LINEなどへ送ったものは相手の端末とトーク履歴に残り、転送もでき、
// 取り消せない。この台帳は「データの入れ子そのものがアクセス境界」という
// 作りで守られているので、共有はその境界に意図的に開ける穴になる。
//
// **氏名は、除外リストで消すのではなく、そもそも組み立てない。**
// 除外リストは項目が増えたときに足し忘れるが、組み立てていないものは出ようがない。
// 既定で扱うのは集計した数と、地区名（地名）だけ。
//
// includePersonal を渡したときだけ、氏名を持つ区分を組み立てる。
// **既定は外したまま**にしてある。既定を開くと、入れたことを忘れて送る事故が起きる。
//
// 既定で出さないもの: 所有者・紹介者の氏名／掲示場所の名前・掲示住所
//                     （「個人宅 塀」のように住居が分かる）
// ここに出ないもの: 電話・携帯・メール・連絡先住所（集計に現れない項目のため。
//                   これらを共有するには一覧の行の共有を使う）
//
// 画像への描画はここでは行わない。Canvas は Node に無く検査できないため、
// 「何をどの順で何件と描くか」だけを純粋関数で組み立て、描画は share-image.js に置く。
//
// Firestore に依存しない純粋な関数だけを置く。

import { orderedColumns } from './schema.js';
import { posterValue, formatValue, isBlank } from './table.js';
import {
  summarize, byDistrict, ageDistribution, replaceCountDistribution,
  byOwner, byIntroducer, stalest, daysSince, lastRefreshedOn,
} from './stats.js';

/**
 * 共有する1行。
 * @typedef {object} ShareRow
 * @property {string} label
 * @property {number} value
 * @property {string} unit
 * @property {string} [note] 補足（住所など）。無い行もある
 */

/**
 * 共有するひとまとまり。
 * @typedef {object} ShareSection
 * @property {string} title
 * @property {ShareRow[]} rows
 */

/**
 * 共有する内容。
 * @typedef {object} ShareSummary
 * @property {string} title
 * @property {string} asOf 'YYYY-MM-DD'
 * @property {ShareRow[]} headline 上部に大きく出す数
 * @property {ShareSection[]} sections
 * @property {boolean} includesPersonal 氏名を含むか。画面で注意を出すために持つ
 */

/** 地区は多い順にこの件数まで出す。全部並べると画像が縦に伸びて読めない */
const DISTRICT_LIMIT = 10;

/** 氏名を含める区分も、同じ理由で件数を絞る */
const PERSON_LIMIT = 10;
const STALE_LIMIT = 20;

/**
 * 共有する内容を組み立てる。
 *
 * @param {Record<string, *>[]} posters
 * @param {string} today 'YYYY-MM-DD'
 * @param {string} candidateName 候補者名。誰の台帳かが分からないと共有の意味がない
 * @param {{includePersonal?: boolean}} [options] 氏名を含めるか。**既定は含めない**
 * @returns {ShareSummary}
 */
export function buildShareSummary(posters, today, candidateName, options = {}) {
  const includePersonal = options.includePersonal === true;
  const list = Array.isArray(posters) ? posters : [];
  const s = summarize(list, today);

  const districts = byDistrict(list).slice(0, DISTRICT_LIMIT);

  /** @type {ShareSection[]} */
  const personal = includePersonal ? [
    {
      title: '複数か所の所有者（上位' + PERSON_LIMIT + '）',
      rows: byOwner(list).slice(0, PERSON_LIMIT).map((row) => ({
        label: row.owner, value: row.count, unit: '件',
      })),
    },
    {
      title: '紹介者別（上位' + PERSON_LIMIT + '）',
      rows: byIntroducer(list).slice(0, PERSON_LIMIT).map((row) => ({
        label: row.introducer, value: row.count, unit: '件',
      })),
    },
    {
      title: '貼替から間があいている場所（上位' + STALE_LIMIT + '）',
      // 経過が数えられない場所は並べない。0日として出すと棒が短くなり
      // 「最近貼った場所」に見えてしまう。件数は「貼替からの経過」の
      // 「日付なし」で分かるので、そちらに任せる
      rows: stalest(list, today, STALE_LIMIT)
        .filter(({ days }) => days !== null)
        .map(({ poster, days }) => ({
          label: String(poster.placeName ?? '').trim() || ('番号 ' + String(poster.no ?? '')),
          value: days,
          unit: '日',
          note: String(poster.address ?? '').trim(),
        })),
    },
  ] : [];

  return {
    title: String(candidateName ?? '').trim() + ' ポスター掲示状況',
    asOf: today,
    includesPersonal: includePersonal,
    headline: [
      { label: '掲示場所', value: s.total, unit: '件' },
      { label: '掲示枚数', value: s.sheets, unit: '枚' },
      { label: '貼替から1年以上', value: s.overOneYear, unit: '件' },
    ],
    sections: [
      {
        title: 'ポスター種別',
        rows: [
          { label: '3連大', value: s.byType.size3L, unit: '枚' },
          { label: '3連小', value: s.byType.size3S, unit: '枚' },
          { label: '2連大', value: s.byType.size2L, unit: '枚' },
          { label: '2連小', value: s.byType.size2S, unit: '枚' },
        ],
      },
      {
        title: '現場の条件',
        rows: [
          { label: '要脚立', value: s.needLadder, unit: '件' },
          { label: 'プラ段', value: s.plaDan, unit: '件' },
          { label: '室内', value: s.indoor, unit: '件' },
          { label: '他党あり', value: s.otherParty, unit: '件' },
        ],
      },
      {
        title: '貼替からの経過',
        rows: ageDistribution(list, today).map((row) => ({
          label: row.label, value: row.count, unit: '件',
        })),
      },
      {
        title: '貼替の回数',
        rows: replaceCountDistribution(list).map((row) => ({
          label: row.label, value: row.count, unit: '件',
        })),
      },
      {
        title: '地区別（上位' + DISTRICT_LIMIT + '）',
        rows: districts.map((row) => ({
          label: row.district, value: row.count, unit: '件',
        })),
      },
      ...personal,
    ],
  };
}

/**
 * 共有する内容を文章にする。
 *
 * **件数が0の行は省く。** 画像は場所があるので0も並べて
 * 「該当が無いこと」を見せられるが、文章は縦に伸びると読まれない。
 *
 * @param {ShareSummary} summary
 * @returns {string}
 */
export function summaryToText(summary) {
  const lines = [summary.title, '（' + summary.asOf + ' 時点）', ''];

  lines.push(summary.headline.map((h) => h.label + ' ' + h.value + h.unit).join('　'));

  for (const section of summary.sections) {
    const rows = section.rows.filter((r) => r.value > 0);
    if (rows.length === 0) continue;

    lines.push('', '■ ' + section.title);
    for (const row of rows) {
      const note = String(row.note ?? '').trim();
      lines.push('・' + row.label + '  ' + row.value + row.unit + (note === '' ? '' : '（' + note + '）'));
    }
  }

  return lines.join('\n');
}

/**
 * 氏名と連絡先の列。**既定では送らない。**
 *
 * 送り先の端末とトーク履歴に残り、転送もでき、取り消せない。
 * includeContact を渡したときだけ含める。
 *
 * @type {ReadonlySet<string>}
 */
const PERSONAL_KEYS = new Set([
  'owner', 'introducer', 'phone', 'mobile', 'email', 'contactAddress',
]);

/**
 * 一覧の行を、そのまま送れる文章にする。
 *
 * 列は**いま見えているもの**を使う（印刷・持ち出しと同じ扱い。
 * 出す量は「列の管理」で調整できる）。ただし氏名と連絡先だけは、
 * 見えていても includeContact を渡さないかぎり送らない。
 *
 * 空の欄は書かない。縦に伸びた文章は読まれないため。
 *
 * @param {Record<string, *>[]} posters いま一覧に出ている行
 * @param {import('./schema.js').Column[]} columns
 * @param {{title: string, asOf: string, condition: string, includeContact?: boolean}} options
 * @returns {string}
 */
export function postersToText(posters, columns, options) {
  const list = Array.isArray(posters) ? posters : [];
  const includeContact = options.includeContact === true;

  const cols = orderedColumns(columns).filter(
    (c) => includeContact || !PERSONAL_KEYS.has(c.key),
  );

  const condition = String(options.condition ?? '').trim();
  const lines = [
    String(options.title ?? '').trim(),
    '（' + options.asOf + ' 時点　' + list.length + ' 件'
      + (condition === '' ? '' : '　' + condition) + '）',
  ];

  for (const poster of list) {
    lines.push('');

    const parts = [];
    for (const column of cols) {
      const value = posterValue(poster, column);
      if (isBlank(value)) continue;
      if (column.type === 'check' && value !== true) continue;
      // 台帳では 0 と空欄は別物だが、送る文章では「3連大 0」が並ぶだけ。
      // 0枚は「無い」と読めるので省く
      if (column.type === 'number' && Number(value) === 0) continue;

      parts.push(column.type === 'check'
        ? column.label
        : column.label + ' ' + formatValue(value, column.type));
    }

    lines.push('■ ' + (parts.length === 0 ? '(空の行)' : parts.join(' / ')));
  }

  return lines.join('\n');
}
