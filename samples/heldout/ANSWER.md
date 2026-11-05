# 正解の形の補い（moyai.answer/0）

運営者の指示書（作り手への指示書 §5）の正解の形を、測る道具（`tests/heldout/answer.ts`）が読めるように、§5 が決めていない所だけを決めたものです。§5 と食い違ったら §5 が勝ちます。見ていない様式の書き手には、指示書と一緒にこの文書を渡します。

## 組のフォルダ

```
<組>/
  README.md                       わざと入れた揺れと食い違いの一覧（指示書 §6）
  WRITER.md                       どんな書き方にしたか・なぜか・乱数の種と「今日」
  gen/                            生成器と check.py（組に 1 つ）
  <施設の id>/                    施設ごと（1 組に 3〜4）
    files/                        資料（名前は「【架空】」で始める）
    user.md                       施設の担当者が答えられること（指示書 §5.3）
    answer/files/<stem>.json      ファイルごとの正解（指示書 §5.1）
    answer/world.json             世界の正解（指示書 §5.2。この施設の分だけ）
```

- `<stem>` はファイルの名前から拡張子を外したもの。`files/` の下に組のフォルダを作ったなら、`<stem>` は `files/` からの道の `/` を `__` にしたもの。
- 組のハッシュは、`measured/` を除くすべてのファイルから取ります。書いたら、どのファイルも変えないでください。

## `answer/files/<stem>.json`

```json
{ "schema": "moyai.answer.file/0", "file": "【架空】….xlsx", "plan": true,
  "records": [ { "sheet": "星取表", "r": 12, "kind": "item", "fields": { } } ] }
```

指示書 §5.1 のとおりです。決めたのは次だけです。

- `file`：`files/` からの相対の道（`/` で区切る）。
- 場所：Excel は `sheet`（シートの名前）と `r`、CSV は `r`（ファイルの物理の行。題や空の行も数える。囲みの中で改行した記録は、記録の始まりの行）、PDF は `seq`、写真は `seq` と `image`。
- 省いてよい欄：`hidden_data`（隠した行・列・シートの中身を計画に入れるべきか：`"include"`／`"exclude"`。隠したものが無ければ省く）、`source_xlsx`（PDF を xlsx から書き出したなら、その xlsx の、組のフォルダからの道。`gen/` の下に置く）、`note`。
- `fields` の名前（§5.1 の星取表の名前に足すもの）：
  - 機器の木を書いた資料（星取表・台帳・完成図書の機器一覧など）の行：`path`（根から自分までの名前の並び。書いてあるとおり）。あれば `code`（機器番号）・`install_year`（設置年の西暦。数）・`specs`（仕様・備考として書いたセルの文字そのものの並び）。
  - 星取表の `marks`：同じ年度に印が 2 つ以上あるなら（予定の列と実績の列など）、その年度の値を記号の並び（左の列から）にする。例 `{ "2026": ["◎", "○"] }`。
  - 作業を書いた行（日報・報告書・発注台帳・工程表など）：その行が表す期間を `date`（1 日）か `start` と `end`（`YYYY-MM-DD`）。工数を書いたなら `manDays`（人・日に直した数）と `manDaysText`（書いてあった文字）。日数（工期）を書いたなら `days`（数）。
  - ほかの名前は自由です（比べるのは値）。

## `answer/world.json`

```json
{
  "schema": "moyai.answer.world/0",
  "facility": { "id": "f-…", "name": "【架空】…", "industry": "waste-incineration", "profile": { } },
  "fiscal_year_start_month": 4,
  "man_day_hours": 8,
  "today": "2026-10-01",
  "equipment": [
    { "id": "E01", "name": "…", "names": { "<file>": "その資料での呼び名" }, "furnace": 1, "install_year": 2002, "code": "…",
      "path": ["設備", "…"], "rows": [ { "file": "<file>", "sheet": "…", "r": 7 } ] }
  ],
  "works": [
    { "id": "W0001", "label": "…", "attribute": "OVERHAUL", "status": "actual", "fiscal_year": 2022,
      "equipment": ["E01"], "start": "2022-04-06", "end": "2022-04-17", "man_days": 24, "days": 12,
      "vendor": "【架空】…", "contract": "…", "precision": false,
      "rows": [ { "file": "<file>", "sheet": "…", "r": 12, "year": 2022, "symbol": "●" }, { "file": "<file>", "r": 40 } ] }
  ],
  "unrecorded": [ { "work": "W0099", "reason": "星取表の書き漏れで、日報にも無い" } ],
  "defects": [ { "kind": "…", "where": "…", "check": "…" } ]
}
```

- `industry`：`waste-incineration`（ごみ焼却）、`night-soil`（し尿処理）、`sewer`（下水道）、`water`（上水道）、`industrial-water`（工業用水道）、`building`（公共建築）、ほか。
- 機器は 1 台ずつ（指示書 §5.2）。`rows`：その機器の名前を書いた行（台帳・星取表・機器一覧などで、機器そのものを書いた行）。場所は `answer/files` の記録と同じ書き方。
- `furnace`：号炉・系統の番号（共通なら null）。
- 作業：
  - `status`：実際に行ったものは `actual`、予定は `planned`。
  - `equipment`：その作業の機器（まとめた工事は、まとめた機器のすべて）。
  - `rows`：**どの資料のどの行が、この作業か**（物差し ⑥ の分母）。星取表の行は、その印の年度を `year` に書く（年度の始まりの西暦）。同じ行の同じ年度に印が 2 つ以上あるなら（予定の列と実績の列など）、その印の記号を `symbol` に書く。1 つの行がいくつかの作業を書いているなら、どの作業にも同じ行を書く。
  - `precision`：精密機能検査なら true（ごみ焼却だけ。ほかの設備は省く）。
  - 工数と日数は世界の値（その作業の全体）。
- `unrecorded`：どの資料にも書いていない作業と、その理由（⑥ の分母に入れない）。
- `defects`：入れた計画の欠け（指示書 §3.5）。
