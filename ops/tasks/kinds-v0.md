---
id: kinds-v0
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 90
verify: ["node --test tests/packs/kinds.test.mjs", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 2 段目の機器の種類 v0：kinds.json と、ごみ焼却の 1 段目への当てはめ

`docs/plan.md` §2.1（共通の設備項目と作業の属性）と §2.7 の「2 段目の当てはめ」を読んでから作る。

## 1. `packs/_kinds/kinds.json` を作る

- `docs/plan.md` §2.1 の 16 種だけを、この順に平らに持つ：ポンプ・送風機・圧縮機・クレーン・コンベヤ・電動機・弁・配管・タンク・熱交換器・ボイラー・受変電・盤・計装・昇降機・空調。足さない、分けない、まとめない。
- コードは `KD.` で始め、§2.1 の分類コードの形 `^[A-Z]{2,4}(\.[A-Z0-9_]{2,16}){1,4}$` に合わせる。次を使う：`KD.PUMP`・`KD.BLOWER`・`KD.COMPRESSOR`・`KD.CRANE`・`KD.CONVEYOR`・`KD.MOTOR`・`KD.VALVE`・`KD.PIPING`・`KD.TANK`・`KD.HEAT_EXCHANGER`・`KD.BOILER`・`KD.SUBSTATION`・`KD.PANEL`・`KD.INSTRUMENT`・`KD.ELEVATOR`・`KD.HVAC`。
- 名前は日本語。法令が名指しする設備の名前か、公の手引きの名前から取る。協会・JIS・ISO の分類の名前と、その分け方を写さない。
- 種類ごとに、根拠を次のどちらか 1 つで書く：
  - 公の出典：法令か、国の機関の手引き・通知で、その設備を名指ししているもの。`title`（名前）・`issuer`（出した機関）・`url`・`state`。`state` は、このセッションでその頁を実際に取って、その設備の名前が載っていることを確かめたときだけ `照合済` にし、確かめた所（条・頁・表など）を `checked` に書く。取っていない・取れなかった・名前を見つけられなかったものは `未確認`。
  - 自分で決めた理由：`ownReason` に 1 行。公の出典が見つからないか、名前が法令や手引きの語とずれるとき。
- 読めるのは e-Gov（法令の本文。`laws.e-gov.go.jp` の API の道もある）・環境省・厚生労働省・国土交通省のサイトだけ。ほかのサイトの URL を出典に書かない（取れないので、書くなら `未確認`）。
- 形の例（値は例。中身はあなたが確かめて書く）：

```json
{
  "schema": "moyai.kinds/0",
  "note": "業種を越える機器の種類（2 段目）。16 種を平らに持つ。docs/plan.md §2.1",
  "kinds": [
    {
      "code": "KD.BOILER",
      "name": "ボイラー",
      "basis": {
        "type": "source",
        "title": "ボイラー及び圧力容器安全規則",
        "issuer": "厚生労働省（e-Gov 法令検索）",
        "url": "https://laws.e-gov.go.jp/law/...",
        "state": "照合済",
        "checked": { "what": "第一条の定義の語", "on": "2026-11-03" }
      }
    },
    {
      "code": "KD.PANEL",
      "name": "盤",
      "basis": { "type": "own", "ownReason": "…（1 行）" }
    }
  ]
}
```

## 2. ごみ焼却の 1 段目に当てる

- `packs/waste-incineration/common.json` の 35 の項目（`systems[].items[]` と `systems[].variants[].items[]`）のどれにも、`kind` を足す。値は kinds.json のコードか `null`。`null` のときは `kindReason`（当てはまらない理由を 1 行）を足す。
- ほかの欄・順・書き方（2 文字の字下げ、1 項目 1 行）を変えない。`verification` などの照らした記録には触れない。
- 1 つの項目が複数の種類にまたがるとき（炉、集じん装置など、いくつもの機器の組）は、主な 1 つを選ぶか、`null` と理由にする。選び方の決まりを kinds.json の `note` に 1〜2 文で書く。

## 3. 試験 `tests/packs/kinds.test.mjs`

node:test で、次を確かめる（網に出ない。ファイルを読むだけ）：

- kinds.json の種類が 16 で、名前が §2.1 の 16 種と同じ順で一致する。
- コードが一意で、§2.1 の形に合い、`KD.` で始まる。
- どの種類も、根拠が公の出典（`title`・`issuer`・`url`・`state` があり、`state` は `照合済` か `未確認`。`照合済` なら `checked` がある）か `ownReason` のどちらか一方だけ。
- common.json の 35 の項目のどれにも `kind` があり、`null` なら `kindReason` が空でない。
- common.json が使うコードが、どれも kinds.json にある。

## 済んだと言える条件

- `node --test tests/packs/kinds.test.mjs`、`node scripts/run-tests.mjs`、`node scripts/check-publish.mjs` が通る。
- report.md に、16 種それぞれの根拠の種類（`照合済`・`未確認`・`ownReason`）の数、照合済にしたものの確かめ方、`null` にした項目の数、未確認のことを書く。
