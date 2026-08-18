#!/usr/bin/env python3
"""品川区の人口CSVから population.js を作る。

使い方:
    python3 poster-app/tools/build-population.py /tmp/jinkou.csv

CSVは品川区オープンデータ「男女・年齢別人口」のもの。
年齢1歳ごとの行になっているため、町字・町丁目ごとに足し上げる。
18歳以上を別に数えるのは、ポスターの用途では有権者数の方が実態に近いため。
"""
import csv
import json
import os
import re
import sys

KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']


def kanji(n: int) -> str:
    """数を漢数字にする（丁目に使うため1〜99）。"""
    if n < 10:
        return KANJI[n]
    tens, ones = divmod(n, 10)
    return ('' if tens == 1 else KANJI[tens]) + '十' + KANJI[ones]


def normalize_chome(text: str) -> str:
    """'１丁目' を '一丁目' にする。丁目でなければそのまま。"""
    t = (text or '').translate(str.maketrans('０１２３４５６７８９', '0123456789')).strip()
    matched = re.match(r'^(\d+)丁目$', t)
    return kanji(int(matched.group(1))) + '丁目' if matched else t


def main(path: str) -> None:
    areas: dict[str, dict[str, int]] = {}
    towns: dict[str, dict[str, int]] = {}
    year = ''

    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            year = row['調査年']
            town = (row['大字・町名'] or '').strip()
            if not town:
                continue

            chome = normalize_chome(row['字・丁目名'])
            area = town + chome if chome else town

            try:
                population = int(row['人口'] or 0)
                min_age = int(row['最小年齢'] or 0)
            except ValueError:
                continue

            for table, key in ((areas, area), (towns, town)):
                entry = table.setdefault(key, {'pop': 0, 'voters': 0})
                entry['pop'] += population
                if min_age >= 18:
                    entry['voters'] += population

    def dump(table):
        return json.dumps(
            {k: [v['pop'], v['voters']] for k, v in sorted(table.items())},
            ensure_ascii=False, indent=0,
        ).replace('\n', '')

    out = f'''// 品川区の町丁目別 人口・有権者数（18歳以上）。
//
// 出典: 品川区オープンデータ「男女・年齢別人口」（{year}年8月1日時点）
//   https://www.city.shinagawa.tokyo.jp/PC/kuseizyoho/kuseizyoho-siryo/kuseizyoho-siryo-toukei/20240216143537.html
//
// 実行時に区のサイトへ取りに行かず、値を埋め込んである。
// URLが毎月変わり、通信の失敗が画面の不具合として現れるため。
// 人口の変化は緩やかなので、年1回ほど入れ替えれば足りる。
//
// このファイルは tools/build-population.py が作る。手で編集しないこと。
// 更新の手順は docs/population-update.md を参照。

/** 集計の基準となった年月 */
export const POPULATION_AS_OF = '{year}年8月';

/** 町字（地区）別。[人口, 18歳以上] */
export const TOWN_POPULATION = {dump(towns)};

/** 町丁目（詳細エリア）別。[人口, 18歳以上] */
export const AREA_POPULATION = {dump(areas)};
'''

    target = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'js', 'population.js')
    with open(target, 'w', encoding='utf-8') as f:
        f.write(out)

    total = sum(v['pop'] for v in towns.values())
    voters = sum(v['voters'] for v in towns.values())
    print(f'{year}年: 町字 {len(towns)} / 町丁目 {len(areas)}')
    print(f'総人口 {total:,} / 18歳以上 {voters:,}')
    print(f'書き出し: {os.path.normpath(target)}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
