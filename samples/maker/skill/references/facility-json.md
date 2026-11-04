# 施設の設定（gen/facility.json）の形

`samples/<業種>/<施設>/gen/facility.json`。施設の性質と、どの資料をどの様式で書くかを決めます。デモの施設（しらかば野）は手で書き、ほかの施設は `samples/maker/facilities.py` が書き出します。`facilities.py` を走らせると、11 施設の設定をすべて書き直します。手で直した所は消えるので、直すなら `facilities.py` の中を直します。手本は次の 2 つです。

- `samples/waste-incineration/shirakabano/gen/facility.json`（5 種の資料と写真）
- `facilities.py` の 11 施設

## 上の段

手で書く施設では、`pack`・`today`・`profile.commissioned` を省けません（`facilities.py` は `pack` と `today` を補う）。

| 項目 | 中身 |
|---|---|
| `id` | 施設の ID（架空。`WI-02`・`NS-01` など。実在の施設 ID の形にしない） |
| `pack` | パックの名前 |
| `name`・`short`・`owner` | 施設の名前・短い名前（ファイル名に入る）・持ち主（「架空市」「架空◯◯広域環境組合」） |
| `seed` | 乱数の種。施設ごとに違える |
| `today` | 物語の「今日」（`2025-12-12`）。この年度の実績は一部だけ載る |
| `years` | 世界の年度の幅 `[始め, 終わり]`（実績のある年度） |
| `planTo` | 計画を何年度まで持つか |
| `profile` | 施設の性質（下） |
| `costScale` | 費用の倍率（施設の規模） |
| `tagStyle` | 機器番号の形：`dash`（`IDF-1-2`）か `num`（`IDF-102`） |
| `vendorStyle`・`vendorPick` | 業者の名前の書き方（`㈱`・`株式会社`・`(株)`）と、役の候補の何番目を使うか |
| `exclude` | この施設に無い機器の key（小さな施設で機器を減らす） |
| `rates` | パックの `rates` を、この施設だけ上書きする（無くてよい） |
| `overrides` | わざと入れる計画の欠け（下） |
| `gapsNote` | 入れた欠けの説明。世界の正解の `gaps` になる。`{kind, check, level, what, note}` |
| `docs` | 書く資料の並び（下） |

### profile

ごみ焼却：`furnace`（`STOKER`・`FLUID`・`SHAFT`・`ROTARY`・`FIXED`）・`furnaces`・`perFurnace`（t/日）・`turbine`・`dust`（`BF`・`EP`）・`ash`（`OUT`・`MELT`・`CEMENT`）・`contract`（`SINGLE`・`OM`）・`commissioned`（竣工の年）・`upgrade`（基幹改良の始めの年度の並び）。

し尿処理：`method`・`methodName`・`capacity_kl_per_day`・`furnaces`（系列の数）・`commissioned`。

軸と順はパックの `pack.json` の `profile` に従います。`catalog[].need` がこの値で機器を選びます。世界の正解にどの軸を残すかは、パックの `world.json` の `profileAnswer` で決まります。新しい業種で軸を足したら、そこにも足します。

### overrides（わざと入れる欠け）

キーは `"<機器の key>|<作業の文字>"` です。

| 値 | 意味 |
|---|---|
| `{"years": [...]}` | その作業を行う年度を決める（間隔を 4 年空けて `interval_max` の欠けにする） |
| `{"skipDone": [年度], "target": "<機器の id>"}` | 計画したが行っていない（星取表は ○ のまま） |
| `{"noFuture": true, "target": "<機器の id>"}` | 「今日」よりあとの計画を持たない |
| `{"skip": [年度], "target": …}` | その年度は計画も実績も持たない |

### 欠けの記録（自動と手）

| 欠け | 入れ方 | 記録 |
|---|---|---|
| 周期の超え（`interval_max`） | `overrides` の `years` | 手で `gapsNote` に書く |
| 法令の点検の抜け | `overrides` の `skipDone` | 手で `gapsNote` に書く |
| 星取表に行が無い（`coverage`） | 星取表の `chartExclude` | 手で `gapsNote` に書く |
| 計画の窓の欠け（`plan_horizon`） | `elecSheet.yearsTo` などを短くする | 手で `gapsNote` に書く |
| 小計の食い違い | 星取表の `mismatchSubtotal`・`mismatchBy` | 自動（`subtotal_mismatch`） |
| 健全度の段の外の値（`scale_valid`） | `mgmtSheet.outOfScale` | 自動 |
| 健全度が悪いのに措置の予定が無い（`followup`） | `mgmtSheet.bad` | 自動 |
| 管理基準に保全方式の列が無い（`plan_fields`） | `mgmtSheet` を置き、`withStrategy` を付けない | 自動 |

自動のものを `gapsNote` にも書くと、二重になります。

## docs（資料）

どの資料も `type` で書き手を選びます。`stem` は、ファイル名の【架空】と施設の短い名前のあとに付く部分です。`stem` が効くのは `chart`・`ledger`・`inspect_csv`・`photo` だけです。`diary`・`diary_csv`・`gantt`・`orders`・`spec_pdf` のファイル名は、年度から決まります。

### chart（星取表、Excel）

| 項目 | 値と意味 |
|---|---|
| `stem`・`title`・`author`・`sheetName`・`titleText` | ファイル名・題・作成者・シート名・題のセルの文（無ければ施設の名前とシート名から作る） |
| `yearsFrom`・`yearsTo` | 年度の列の幅 |
| `hideYears` | 頭の何年度の列を隠すか |
| `layout` | 名前の列の配置：`cols`（段ごとに列）・`indent`（1 列に字下げ）・`numbered`（番号 1 / 1-1 / 1-1-1 と 1 列）・`merged`（段ごとの列で、大分類を縦に結合） |
| `header`・`paFull` | 年度の見出し（`paFull` は `pa` の見出しを元号を略さずに書く）：`era2`（和暦と西暦の 2 段）・`eraNL`（1 つのセルに改行）・`fy4`（「2016年度」）・`pa`（年度の下に予定／実績）・`eraStack`（元号を 1 段に結合し、その下に年の数） |
| `legend` | 記号：`pd`（○ ◎ ● △ ○→）・`simple`（○ ● ▲ 延期）・`pa`（予定の列と実績の列に分ける） |
| `legendTop`・`footNotes` | 凡例を上に置くか、表の下の注記（`{last}` は最後の年度） |
| `costUnit` | `千円`・`円`。無しなら費用の列が無い |
| `codeCol` | 機器番号の列 |
| `groups` | Excel の行のグループ |
| `subtotals`・`totalsTop`・`totalLabel` | 小計を置く設備の key、合計を上に置くか、合計の言葉 |
| `mismatchSubtotal`・`mismatchBy` | わざと小計を食い違わせる設備と額 |
| `parentSummary` | 親の行に下の行のまとめの印を書く設備 |
| `ditto` | 上と同じ名前を「〃」と書く割合（`merged` で） |
| `secondTable` | 1 シートに 2 つ目の表 |
| `sysPrefix`・`sysVariant`・`bullets` | 設備の行の番号の付け方（`num`・`paren`・`box`・`none`）、呼び名の何番目、「・」を付けるか |
| `furnaceStyle`・`unitStyle`・`commonStyle` | `naming` の何番目を使うか（並びにすると行ごとに揺れる） |
| `nameVariant`・`names` | 機器の呼び名の何番目（機器ごとに `names` で決められる） |
| `nameComment` | 呼び名が台帳と違う行に、Excel のメモを付ける割合 |
| `chartExclude` | 星取表に載せない機器（`coverage` の欠けにするなら `gapsNote` に手で書く） |
| `breakdownRows`・`breakdownMemo` | 事後の補修を行で載せるか、メモで載せるか |
| `colLabels`・`topLabel`・`furnaceAllLabel`・`outageW` | 見出しの言葉、施設全体の行と炉全体の行の名前、定期整備の行の言い方の何番目 |
| `workNewline`・`costSparse`・`shadeFuture`・`memoComments`・`yearTotals` | 作業の文字の中の改行、費用の書き漏れ、計画の年度の網掛けの色、延期などのメモ、年度ごとの合計 |
| `elecSheet`・`sheetMech`・`sheetElec` | 電気・計装を別のシートにする（`elecSheet` の中で上の項目を上書き） |
| `mgmtSheet` | 機器別管理基準のシート（`name`・`items`・`defs`・`life`・`bad`・`outOfScale`・`withStrategy`） |
| `notes` | 注記のシートの行 |

### diary（作業日報、Excel の帳票）

`{type: "diary", years: [始め, 終わり], furnaceStyle: [...], kana, landscapeFrom}`。年度ごとのブック・月ごとのシート・1 日 1 枚です。

- 明細は結合した 1 つのセルに平打ちします。
- 印刷の設定で、1 日 1 枚が A4 の 1 頁になります。
- `kana` は半角カナの割合です。
- `landscapeFrom` の年度から A4 横の様式に変わります。

### diary_csv（作業実績の書き出し、CSV）

`{type: "diary_csv", years, encoding: "cp932" | "utf-8", kana, furnaceStyle}`。委託先の仕組みからの書き出しで、1 行 1 件です。

### inspect_csv（点検の記録、CSV）

`{type: "inspect_csv", stem, years, encoding, items: [[機器の key, 項目, 単位, 下, 上], ...]}`。

### gantt（工程表、Excel）

`{type: "gantt", years}`。年度ごとのシートに、週のガントを書きます。

### orders（発注台帳、Excel）

`{type: "orders", years, textDatesUntil, oneCellPeriod, sheetFmt, author}`。

- `textDatesUntil` の年度までは、日付を和暦の文字で書きます。
- `oneCellPeriod` は「R8.4～R9.3」のように、期間を 1 つのセルに書きます。
- `sheetFmt` はシート名の形です（`{era}` など）。

### ledger（機器台帳、Excel）

`{type: "ledger", stem, codeInName, nameVariant, perFurnace, sheet, parts}`。

- `codeInName` は、名前に機器番号「(BFP-101)」を入れる割合です。
- `perFurnace` は、号炉ごとに行を分けるかです。

### spec_pdf（完成図書 第3編 機器仕様一覧表、PDF）

`{type: "spec_pdf"}`。竣工のときのまま、数量でまとめて書きます。

### photo（日常点検表の写真、JPEG）

`{type: "photo", stem, title, weeks: [週の始めの日], maxRows, items: [[機器の key, 項目, 基準, "check" | [下, 上], (号機の id の並び)], ...], unreadable}`。週ごとに 1 枚です。影やぼけで読めなくしたセルは、正解に「読めない」と書きます。
