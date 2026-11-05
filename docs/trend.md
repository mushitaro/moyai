# 試験と物差しの推移

`node scripts/trend.mjs` が試験を走らせて作る（手で書かない）。日ごとに、その日の最後の実行の値を出す。元の記録は `ops/trend.jsonl`（足すだけ）。
物差しの目標（docs/plan.md §2.6）：① 原本の漏れ 0、② 未解決 0、③ 読み取りの正しさ 100%（開発用）。⑤ 質問の数は版ごとに比べる。

## 試験の数

| 日付 | 時刻（JST） | コミット | node:test | vitest | 結果 |
|---|---|---|---:|---:|---|
| 2026-11-03 | 21:58 | `3f98947`+ | 138 | 599 | 通った |
| 2026-11-04 | 09:17 | `f469ab7`+ | 140 | 656 | 通った |
| 2026-11-05 | 13:00 | `8f95b9e` | 153 | 928 | 通った |

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
| 2026-11-05 | 通った | fictional-1 | equipment-ledger.xlsx | 0 | 0 | 100%（235/235） |
| 2026-11-05 | 通った | fictional-1 | plan-hoshitori.xlsx | 0 | 0 | 100%（2319/2319） |
| 2026-11-05 | 通った | fictional-1 | daily-report.csv | 0 | 0 | 100%（2390/2390） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2019.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2020.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2021.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2022.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2023.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2024.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2025.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f1-fy2026.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2019.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2020.pdf | 0 | 0 | 100%（7/7） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2021.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2022.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2023.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2024.pdf | 0 | 0 | 100%（6/6） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2025.pdf | 0 | 0 | 100%（4/4） |
| 2026-11-05 | 通った | fictional-1 | reports/report-f2-fy2026.pdf | 0 | 0 | 100%（1/1） |
| 2026-11-05 | 通った | fictional-2 | equipment-ledger.xlsx | 0 | 0 | 100%（55/55） |
| 2026-11-05 | 通った | fictional-2 | plan-hoshitori.xlsx | 0 | 0 | 100%（127/127） |

| 日付 | 施設 | ⑤ 質問 | 計画 | 資料をまたいで 1 つの明細に結べた作業 | ⑥ 取り戻せた割合 | ⑥ のうち工数 | ⑥ のうち日数 |
|---|---|---:|---|---|---|---|---|
| 2026-11-03 | fictional-1 | 20 | 作った | 100%（83/83） | 100%（142/142） | 100%（78/78） | 100%（107/107） |
| 2026-11-03 | fictional-2 | 4 | 作った | 測っていない | 100%（89/89） | 測っていない | 測っていない |
| 2026-11-04 | fictional-1 | 20 | 作った | 100%（83/83） | 100%（142/142） | 100%（78/78） | 100%（107/107） |
| 2026-11-04 | fictional-2 | 4 | 作った | 測っていない | 100%（89/89） | 測っていない | 測っていない |
| 2026-11-05 | fictional-1 | 41 | 作った | 100%（1473/1473） | 100%（1561/1561） | 100%（161/161） | 100%（107/107） |
| 2026-11-05 | fictional-2 | 4 | 作った | 測っていない | 100%（89/89） | 測っていない | 測っていない |

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
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | ledger/kiki-daicho_R8.xlsx | xlsx | 0 | 0 | 計画なし（測れない） |
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | star/choki-hozen-keikaku_hoshitori.xlsx | xlsx | 0 | 204 | 計画なし（測れない） |
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | daily/sagyo-nippo_2024-2026.csv | csv | 0 | 4642 | 計画なし（測れない） |
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | daily/koji-jisseki_H31-R5.csv | csv | 0 | 282 | 計画なし（測れない） |
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | report/R6-2go-teiki-seibi_jisseki.pdf | pdf | 128 | 60 | 計画なし（測れない） |
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | report/2023-zenkyushi-tenken_shukei.pdf | pdf | 14 | 8 | 計画なし（測れない） |
| heldout-3 | reader-freeze-3 | 2026-11-04 09:16 | photo/IMG_20231006_093214.jpg | jpg | 読んでいない | — | — |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-ashihara/【架空】葦原環境センター_作業日報_R8.9月.xlsx | xlsx | 0 | 0 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-ashihara/【架空】葦原環境センター_修繕点検費実績_R6-R8.xlsx | xlsx | 0 | 20 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-kirinodai/【架空】霧野台清掃工場_R7_1号炉定期整備工事_作業報告書.pdf | pdf | 測っていない | 170 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-kirinodai/【架空】霧野台清掃工場_作業日報データ_R7-R8.csv | csv | 0 | 2073 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-kirinodai/【架空】霧野台清掃工場_整備計画表_R2-R11.xlsx | xlsx | 0 | 533 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-kirinodai/【架空】霧野台清掃工場_日常点検表_R8.9.21-27.jpg | jpg | 読んでいない | — | — |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-shiomigawa/【架空】汐見川衛生センター_機器台帳.pdf | pdf | 測っていない | 11 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-shiomigawa/【架空】汐見川衛生センター_設備点検記録_R6.xlsx | xlsx | 0 | 856 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-yanase/【架空】柳瀬中継ポンプ場_保全計画表_H30-R12.xlsx | xlsx | 0 | 18 | 計画なし（測れない） |
| heldout-5 | reader-freeze-6 | 2026-11-05 12:52 | f-yanase/【架空】柳瀬中継ポンプ場_修繕点検履歴_H30-R7.csv | csv | 0 | 349 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-ashihara/【架空】葦原CP_1号炉定期整備工事報告書_R7.pdf | pdf | 測っていない | 184 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-ashihara/【架空】葦原CP_作業日報データ_R7年度.csv | csv | 0 | 156 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-ashihara/【架空】葦原CP_設備整備計画表_R1-R12.xlsx | xlsx | 0 | 524 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-kirinose/【架空】霧ノ瀬浄化C_主ポンプ月例点検記録_R7.xlsx | xlsx | 0 | 187 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-kirinose/【架空】霧ノ瀬浄化C_維持管理作業日報_R8.8.xlsx | xlsx | 0 | 192 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-oboroya/【架空】朧谷環境工場_日常点検表_R8.9.17.jpg | jpg | 読んでいない | — | — |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-oboroya/【架空】朧谷環境工場_発注台帳_R3-R8.xlsx | xlsx | 0 | 511 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-tenkyodai/【架空】天鏡台浄水場_修繕報告書_R7-R8.xlsx | xlsx | 0 | 189 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-tenkyodai/【架空】天鏡台浄水場_機器台帳.pdf | pdf | 測っていない | 5 | 計画なし（測れない） |
| moyai-heldout-4 | reader-freeze-5 | 2026-11-05 01:27 | f-tenkyodai/【架空】天鏡台浄水場_長期保全計画表_2024-2038.xlsx | xlsx | 0 | 284 | 計画なし（測れない） |

| 組 | ⑤ 質問（台本が答えた・開いたまま） | 計画 | ⑥ 取り戻せた割合 | ⑥ のうち工数 | ⑥ のうち日数 |
|---|---|---|---|---|---|
| heldout-1 | 24（9・15） | 作らなかった（未解決のセル 1428・答えの無い質問 15） | 0%（0/142） | 0%（0/60） | 0%（0/73） |
| heldout-2 | 63（22・41） | 作らなかった（未解決のセル 917・答えの無い質問 41） | 0%（0/142） | 0%（0/63） | 0%（0/83） |
| heldout-3 | 76（52・24） | 作らなかった（未解決のセル 5196・答えの無い質問 24） | 0%（0/142） | 0%（0/64） | 0%（0/104） |
| heldout-5 | 103（78・25） | 作らなかった（f-ashihara：未解決のセル 20・f-ashihara：答えの無い質問 2・f-kirinodai：未解決のセル 2776・f-kirinodai：答えの無い質問 3・f-shiomigawa：未解決のセル 867・f-shiomigawa：答えの無い質問 14・f-yanase：未解決のセル 367・f-yanase：答えの無い質問 6） | 0%（0/358） | 0%（0/151） | 0%（0/77） |
| moyai-heldout-4 | 215（145・70） | 作らなかった（f-ashihara：未解決のセル 864・f-ashihara：答えの無い質問 17・f-kirinose：未解決のセル 379・f-kirinose：答えの無い質問 35・f-oboroya：未解決のセル 511・f-oboroya：答えの無い質問 6・f-tenkyodai：未解決のセル 478・f-tenkyodai：答えの無い質問 12） | 0%（0/501） | 0%（0/90） | 0%（0/18） |

見ていない様式の結果は、測った値のまま出す（直したら、新しい組を新しい凍結の読み手で測る）。手順と正解の形は samples/heldout/README.md。写真は AI が読むので、この台本では読まない。
