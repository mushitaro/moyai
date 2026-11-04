# 正解の形

正解は、生成器がセルや行を書いた、その場で記録します（`samples/maker/book.py` の `Answer.rec` と `ev`、`World.link`）。資料を読み直して作りません。正解は読み手（AI）に渡さず、試験だけが読みます。

## 1. ファイルごとの正解（`answer/files/<stem>.json`）

`<stem>` は、ファイル名から拡張子を外したものです。

```json
{ "file": "【架空】….xlsx", "plan": true, "records": [ { "sheet": "星取表", "r": 12, "kind": "item", "fields": { } } ] }
```

- `plan`：保全計画の星取表なら true、ほかは false。
- `records`：データを持つ行だけを並べます。題・凡例・見出し・注記・空の行は並べません。
- `kind`：
  - `item`：データの行
  - `parent`：木の親の行
  - `subtotal`・`total`：小計と合計。`fields` は空にします。
- 場所：

  | 形式 | 場所の持ち方 |
  |---|---|
  | Excel | `sheet` と `r`（1 から） |
  | CSV | `r`（1 行目が 1） |
  | PDF | `seq`。文書の中の parent・item・subtotal・total の行の順で、0 から数えます。見出し・題・頁の外の文字は数えません |
  | 写真 | `seq` と `image`（ファイル名） |
- 値は、書いてあるとおりに入れます。和暦の日付は `YYYY-MM-DD` に、「1,500」は 1500 に直してかまいません。値は文字・数・日付だけで、入れ子にしません。
- 工数は `manDays`（数）と `manDaysText`（書いてあった文字）の両方を入れます。

### 星取表の項目

| 項目 | 中身 |
|---|---|
| `path` | 根から自分までの名前の並び。頭の番号・字下げの空白・「・」は外します。「〃」は、指している名前に直します |
| `work`・`code`・`cycle`・`cost`・`unit` | 作業の文字・機器番号・周期（数）・費用（書いてあるとおりの数。千円なら千円のまま）・費用の単位 |
| `marks` | `{ "年度の始めの西暦 4 桁": "記号" }`。記号の無い年度は入れません。予定と実績を 2 列に分けた様式では、ここに実績を入れます |
| `plans` | 予定と実績を 2 列に分けた様式の、予定の列 |
| `memo`・`comments` | 備考の文と、Excel のメモ（`{ "A1 の形の番地": "メモの文" }`） |

- 親の行に書いた下の行のまとめ（印・費用の合計）は、親の行に入れません。親の行が自分の作業を持つときは入れます。
- 3 年度を結合したセル（基幹改良）は、結合の掛かる年度すべてに同じ文字を入れます。

### 帳票（作業日報・写真）

- 明細の 1 行ごとに `item` を 1 つ置きます。その枚の項目（日付・番号・頁・天候・記入者など）も、その行の `fields` に入れます。
- 明細の無い枚は、枚の最初のラベルの行を 1 つの `item` にし、枚の項目だけを入れます。
- 明細の空の行は並べません。
- 写真の読めなくしたセルは、値を「読めない」にします。

### 証拠（`gen/evidence/<stem>.json`）

行ごとに、値が書いてあるセルの番地と値の並び（`cells: [["B8", "…"], …]`）を持ちます。`check.py` は、Excel と CSV をこの番地で、PDF を頁の文字で照らします。写真は大きさと行の有無だけを見て、値は照らしません。読み手には渡しません。

## 2. 世界の正解（`answer/world.json`）

| 項目 | 中身 |
|---|---|
| `schema`・`maker` | 形の版、生成器の版・種・「今日」・決まりのファイル |
| `facility`・`profile` | 施設と性質 |
| `rates` | 使った割合 |
| `files` | 資料の並び（ファイル名・`plan`・行の数） |
| `assets` | 機器 1 台ずつ（部位も） |
| `works` | 作業 |
| `contracts` | 契約 |
| `links` | どの資料のどの行が、どの作業か |
| `unrecorded`・`unrecordedByReason` | どの資料にも書いていない作業と、その理由。理由ごとの数 |
| `gaps` | わざと入れた計画の欠け |
| `errata` | わざと入れた書き漏れ・年度の書き間違い・最後の年度の未反映 |
| `upgrade` | 基幹改良の年度と契約 |
| `counts` | 数（機器・作業・行った作業・契約・結びのある作業・書いていない作業） |

### assets（機器）

各機器は次の項目を持ちます：`id`・`name`・`system`・`class`・`furnace`・`unit`・`part`・`parent`・`commonKind`・`installed`・`added`（竣工のあとに足した機器）・`tag`・`names`。

炉全体（`F-<n>`）と全炉（`ALL`）は、定期整備と全休炉の行のための仮の機器（`pseudo`）です。`counts.assets` に数えません。

`names` は、資料ごとの呼び名です。`{ファイル名: そこでの呼び名}` の形で持ちます。

### works（作業）

各作業は次の項目を持ちます。

| 項目 | 中身 |
|---|---|
| `id`・`asset`・`task` | 作業の ID・機器の ID・作業の文字 |
| `attr` | `INSPECT`・`OVERHAUL`・`REPLACE`・`UPGRADE`。事後の補修や窓の段は null |
| `strategy` | `時間基準保全`・`事後保全`・`定期整備の段`（窓の段）・`日常点検`（日報にだけある点検） |
| `fy`・`plannedFy` | 行った年度・計画した年度 |
| `status` | 下の表のどれか |
| `done` | 行ったか |
| `start`・`end`・`manDays`・`days` | 開始日・終了日・工数・工期 |
| `vendor`・`contract`・`legal`・`rollup` | 業者・契約・法令の点検・まとめた工事の行 |
| `postponedFrom` | 延期した作業の、もとの年度 |

`status` の値：

| 値 | 意味 |
|---|---|
| `done` | 行った |
| `partial` | 一部だけ行った |
| `postponed` | 延期した |
| `extra` | 計画外の臨時 |
| `not_done` | 計画したが行っていない |
| `planned` | 先の計画 |
| `planned_cur`・`done_cur` | 「今日」の年度の計画・実績 |
| `breakdown` | 事後の補修 |
| `routine` | 日報にだけある細かな点検 |

### links（結び）

`{work, file, sheet, r | seq, year（星取表）, day（日報）, contract（発注台帳）, how}`。

`how` は結びの強さです。

| how | 意味 | `counts.linkedWorks` に数えるか |
|---|---|---|
| 無し | 作業そのものを書いた行（星取表の印・日報の行・工程表の行） | 数える |
| `contract` | 単独の契約の行 | 数える |
| `group` | まとめて 1 行にした日報の行（群の機器の全台を結ぶ） | 数える |
| `memo` | 星取表の Excel のメモに書いた事後の補修 | 数える |
| `annual` | 年間の委託の行 | 数えない |
| `bundle` | まとめた定期補修工事の行 | 数えない |
| `rollup` | 炉全体・全休炉の行 | 数えない |
| `upgrade` | 継続費の基幹改良の行 | 数えない |

### gaps（計画の欠け）

`{kind, check, level, what | file・sheet・r, note}`。

- `check` は、MOYAI の検査のうちどれが見つけるはずかです。値は `interval_max`・`coverage`・`plan_horizon`・`plan_fields`・`followup`・`scale_valid` のどれかです。合う検査が無ければ null にします。
- `level` は、法令の点検の `level` と同じ値です。
