# 試験と物差しの推移

`node scripts/trend.mjs` が試験を走らせて作る（手で書かない）。日ごとに、その日の最後の実行の値を出す。元の記録は `ops/trend.jsonl`（足すだけ）。
物差しの目標（docs/plan.md §2.6）：① 原本の漏れ 0、② 未解決 0、③ 読み取りの正しさ 100%（開発用）。⑤ 質問の数は版ごとに比べる。

## 試験の数

| 日付 | 時刻（JST） | コミット | node:test | vitest | 結果 |
|---|---|---|---:|---:|---|
| 2026-11-03 | 21:58 | `3f98947`+ | 138 | 599 | 通った |
| 2026-11-04 | 08:31 | `59fcad9`+ | 140 | 651 | 通った |

## 取り込みの物差し（import.dev、工場の開発用の資料）

| 日付 | 試験 | 施設 | 資料 | ① 原本の漏れ | ② 未解決のセル | ③ 読み取りの正しさ |
|---|---|---|---|---:|---:|---|
| 2026-11-03 | 通った | fictional-1 | equipment-ledger.xlsx | 0 | 0 | 100%（43/43） |
| 2026-11-03 | 通った | fictional-1 | plan-hoshitori.xlsx | 0 | 0 | 100%（212/212） |
| 2026-11-03 | 通った | fictional-1 | daily-report.csv | 測っていない | 0 | 100%（479/479） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2019.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2020.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2021.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2022.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2023.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2024.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2025.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f1-fy2026.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2019.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2020.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2021.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2022.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2023.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2024.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2025.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-03 | 通った | fictional-1 | reports/report-f2-fy2026.pdf | 0 | 0 | 100%（1/1） |
| 2026-11-03 | 通った | fictional-2 | equipment-ledger.xlsx | 0 | 0 | 100%（55/55） |
| 2026-11-03 | 通った | fictional-2 | plan-hoshitori.xlsx | 0 | 0 | 100%（127/127） |
| 2026-11-04 | 通った | fictional-1 | equipment-ledger.xlsx | 0 | 0 | 100%（43/43） |
| 2026-11-04 | 通った | fictional-1 | plan-hoshitori.xlsx | 0 | 0 | 100%（212/212） |
| 2026-11-04 | 通った | fictional-1 | daily-report.csv | 0 | 0 | 100%（479/479） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2019.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2020.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2021.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2022.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2023.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2024.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2025.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f1-fy2026.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2019.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2020.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2021.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2022.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2023.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2024.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2025.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-04 | 通った | fictional-1 | reports/report-f2-fy2026.pdf | 0 | 0 | 100%（1/1） |
| 2026-11-04 | 通った | fictional-2 | equipment-ledger.xlsx | 0 | 0 | 100%（55/55） |
| 2026-11-04 | 通った | fictional-2 | plan-hoshitori.xlsx | 0 | 0 | 100%（127/127） |

| 日付 | 施設 | ⑤ 質問 | 計画 | 資料をまたいで 1 つの明細に結べた作業 | ⑥ 取り戻せた割合 | ⑥ のうち工数 | ⑥ のうち日数 |
|---|---|---:|---|---|---|---|---|
| 2026-11-03 | fictional-1 | 20 | 作った | 100%（83/83） | 100%（142/142） | 100%（78/78） | 100%（107/107） |
| 2026-11-03 | fictional-2 | 4 | 作った | 測っていない | 100%（89/89） | 測っていない | 測っていない |
| 2026-11-04 | fictional-1 | 20 | 作った | 100%（83/83） | 100%（142/142） | 100%（78/78） | 100%（107/107） |
| 2026-11-04 | fictional-2 | 4 | 作った | 測っていない | 100%（89/89） | 測っていない | 測っていない |

⑥ の分母は、正解の世界の実績の作業のうち、その回に読んだ資料のどれかに書いてあるもの。戻せた＝読んだ資料の出どころ（星取表の印・日報の行・報告書の行）を 1 つの実績の明細がすべて持つ。工数・日数は、作業ごとに書いてある作業だけを分母にする。
報告書の PDF の ① は、工場に PDF の事実（別の読み手が取ったもの）が無いので、PDF の元の xlsx を MOYAI の Excel の読み手で読んだ表示の文字と、中身のある行ごとに比べた。
この表にまだ載せていないもの：写真の ③ と要確認の数（tests/unit/import/photo-measure.test.ts が測る）、④ 検査の正しさ（tests/unit/review/measure.test.ts が測る）。CSV の ① は、工場の別の読み手（Python の csv。samples/factory/csv_facts.py）が取った記録と比べる。

## 見ていない様式（import.heldout。凍結した読み手で、組ごとに 1 回だけ測った値）

| 組 | 読み手 | 測った時刻（JST） | 資料 | 形式 | ① 原本の漏れ | ② 未解決のセル | ③ 読み取りの正しさ |
|---|---|---|---|---|---:|---:|---|
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | daicho/setsubi-daicho_R8.xlsx | xlsx | 0 | 175 | 計画なし（測れない） |
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | hoshitori/hozen-keikaku-hyo_R8-R10.xlsx | xlsx | 0 | 0 | 計画なし（測れない） |
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | nippo/sagyo-jisseki-ichiran_R4-R7.csv | csv | 0 | 546 | 計画なし（測れない） |
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | nippo/sagyo-nippo_2026-04_08.csv | csv | 0 | 535 | 計画なし（測れない） |
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | houkoku/R5-teiki-seibi_sagyo-houkoku.pdf | pdf | 0 | 155 | 計画なし（測れない） |
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | houkoku/R7-DCS-koshin_kansei-houkoku.pdf | pdf | 0 | 17 | 計画なし（測れない） |
| heldout-1 | reader-freeze-1 | 2026-11-04 07:16 | shashin/IMG_20231012_houkoku-p1.jpg | jpg | 読んでいない | — | — |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | daicho/setsubi-daicho_R8.xlsx | xlsx | 0 | 0 | 計画なし（測れない） |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | hoshitori/hozen-jisseki-keikaku_R1-R10.xlsx | xlsx | 0 | 0 | 計画なし（測れない） |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | daily/hozen-system_WO-export_2022-2026.csv | csv | 0 | 713 | 計画なし（測れない） |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | daily/sagyo-nippo-shukei_R8-kamiki.csv | csv | 0 | 86 | 計画なし（測れない） |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | reports/kanryo-hokoku_R5_1go-zenkyushi.pdf | pdf | 15 | 90 | 計画なし（測れない） |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | reports/sekou-keikaku_R8_2go-teiki.pdf | pdf | 167 | 28 | 計画なし（測れない） |
| heldout-2 | reader-freeze-2 | 2026-11-04 08:29 | photos/IMG_20261003_0841.jpg | jpg | 読んでいない | — | — |

| 組 | ⑤ 質問（台本が答えた・開いたまま） | 計画 | ⑥ 取り戻せた割合 | ⑥ のうち工数 | ⑥ のうち日数 |
|---|---|---|---|---|---|
| heldout-1 | 24（9・15） | 作らなかった（未解決のセル 1428・答えの無い質問 15） | 0%（0/142） | 0%（0/60） | 0%（0/73） |
| heldout-2 | 63（22・41） | 作らなかった（未解決のセル 917・答えの無い質問 41） | 0%（0/142） | 0%（0/63） | 0%（0/83） |

見ていない様式の結果は、測った値のまま出す（直したら、新しい組を新しい凍結の読み手で測る）。手順と正解の形は samples/heldout/README.md。写真は AI が読むので、この台本では読まない。
