---
id: night-soil-v0
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 10
timeoutMin: 60
verify: ["node --test tests/packs/night-soil.test.mjs", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# し尿処理のパック v0：1 段目の項目と 2 段目への当てはめ

`docs/plan.md` §2.1・§2.7、`packs/waste-incineration/common.json` と `sources.json`（形の手本）、`packs/_kinds/kinds.json`（20 種）、`tests/packs/kinds.test.mjs` を読んでから作る。**このパッチは `packs/night-soil/` と `tests/packs/night-soil.test.mjs` だけに触れる**（業種を足すときにコードを足さないことを示すため。`src/` と ほかのパックに触れない）。

## 1. `packs/night-soil/common.json`

- 環境省『廃棄物処理施設長寿命化総合計画作成の手引き（し尿処理施設・汚泥再生処理センター編）』（令和 3 年 3 月改訂）`https://www.env.go.jp/recycle/waste/3r_network/7_misc/gl-ple_hw.pdf` の表Ⅱ-4（印刷頁 27、PDF の 35 枚目。列は「設備」と「装置名」）を、このセッションで PDF を取って照らし、設備と装置をそのとおりに項目にする。表の文は写さず、名前だけを使う。表に「中略」などで隠れた行があれば、見えている行だけを項目にし、隠れていたことを書く。
- 分類コードの頭は `NS`（例 `NS.RECV.SCREEN`）。§2.1 の形 `^[A-Z]{2,4}(\.[A-Z0-9_]{2,16}){1,4}$` に合わせる。
- 形はごみ焼却の common.json と同じ（`schema`・`pack`・`source`・`table`・`page`・`verification`・`verifiedBy`・`verifiedAt`・`systems`）。照らせたら `verification` は `原典照合済`、照らせなければ `未確認`。
- どの項目にも、2 段目の種類（kinds.json の 20 種のコード）か、`null` と `kindReason` を付ける。当て方の決まりはごみ焼却と同じ（名前か働きで当たる機器ならその種類、機器の組で主な機器が 20 種に無ければ null と理由）。

## 2. `packs/night-soil/sources.json`

- 手引きの PDF（URL・取得日・SHA-256・照らした頁・照らした者）と、同じ調査のし尿処理施設の表 `https://www.env.go.jp/recycle/waste_tech/ippan/r6/data/seibi/facility/08.xlsx`（取って、見出しの段・「汚水処理」「汚泥処理」の列・「ごみ処理事業実施方式」「運転管理体制」の列・施設の改廃が空の稼働の数を数え、数え方を書く。元の表は入れない）。照らしていない欄は null と `unverified`。

## 3. 試験 `tests/packs/night-soil.test.mjs`（node:test）

- common.json と sources.json が読め、コードが一意で形に合い `NS.` で始まる。どの項目にも kind か kindReason。使う kind が kinds.json にある。
- このパックの語（項目の名前）が `src/` に 1 つも出ない（`src/` が無ければ空として通る）。

## 済んだと言える条件

- verify の 3 つが通る。report.md に、項目の数、2 段目に当たった数と null の数、照らした所、全国の表の稼働の数と数え方、未確認のことを書く。
