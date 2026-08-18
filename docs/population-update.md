# 人口データの更新手順

`poster-app/public/js/population.js` は、品川区の町丁目別人口を
**値として埋め込んだファイル**です。実行時に区のサイトへ取りに行きません。

## なぜ埋め込みなのか

- 配信元のURLが**毎月変わる**（`contentshozon2026/202608_jinkou.csv` のような形）
- 実行時に取りに行くと、通信の失敗が「グラフが出ない」という不具合として現れる
- 人口の変化は緩やかで、年1回ほど入れ替えれば実用上足りる

## 出典

品川区オープンデータ「男女・年齢別人口」

https://www.city.shinagawa.tokyo.jp/PC/kuseizyoho/kuseizyoho-siryo/kuseizyoho-siryo-toukei/20240216143537.html

このページに月ごとのCSVが並んでいます。最新のものを使ってください。

## 更新のしかた

1. 上のページから最新のCSVのURLを控える（例: `.../contentshozon2026/202608_jinkou.csv`）
2. 次を実行する（`CSV_URL` を差し替える）

```bash
CSV_URL="https://www.city.shinagawa.tokyo.jp/contentshozon2026/202608_jinkou.csv"
curl -sL "$CSV_URL" -o /tmp/jinkou.csv && python3 poster-app/tools/build-population.py /tmp/jinkou.csv
```

3. `npm test` が通ることを確認する
4. ダッシュボードの「人口あたりのカバー率」で、注記の日付が変わっていることを確認する

## データの形

CSV は年齢1歳ごとの行になっています。集計時に次の2つを作ります。

| 種類 | 中身 |
|---|---|
| `TOWN_POPULATION` | 町字（地区）別。`[総人口, 18歳以上]` |
| `AREA_POPULATION` | 町丁目（詳細エリア）別。`[総人口, 18歳以上]` |

**18歳以上を分けているのは、ポスターの用途では有権者数の方が実態に近いため**です。
子どもの多い地域と高齢者の多い地域では、同じ人口でも有権者数が大きく違います。

## 注意

- 居住者が極端に少ない地区（東八潮は0人、広町は184人）は、
  1枚の増減で率が跳ねるため**カバー率の順位から外しています**（下限1,000人）。
  掲示している枚数はグラフ下の注記に出ます
- 品川区外の掲示場所は分母が無いため対象外です
