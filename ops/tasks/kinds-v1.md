---
id: kinds-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 10
timeoutMin: 60
verify: ["node --test tests/packs/kinds.test.mjs", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 2 段目の機器の種類 v1：4 種を足し、ごみ焼却の当てはめを直す

運営者の決定（2026-11-03）：2 段目の機器の種類に、**炉・集じん装置・発電機・破砕・切断機** の 4 種を足して 20 種にする。理由：16 種のままでは、ごみ焼却の 35 項目のうち 27 が「当たる種類が無い」となり、業種をまたぐ横串の行に並ばないため。どの 4 種も、火力・下水の汚泥焼却・リサイクル施設などにもある機器。

`docs/plan.md` §2.1・§2.7、いまの `packs/_kinds/kinds.json`（v0。根拠の書き方の手本）と `tests/packs/kinds.test.mjs` を読んでから作る。

## 1. `packs/_kinds/kinds.json` に 4 種を足す

- いまの 16 種の欄・順・根拠には触れない。末尾に次の 4 つを、この順で足す：
  - `KD.FURNACE`「炉」：焼却炉・溶融炉・ガス化炉など、燃やすか溶かすための炉（ボイラーは別の種類のまま）。
  - `KD.DUST_COLLECTOR`「集じん装置」：排ガスからばいじんを除く装置（ろ過式・電気式などを分けない）。
  - `KD.GENERATOR`「発電機」：発電機と、それを回す蒸気タービン・ガスタービン・エンジンの組。
  - `KD.CRUSHER`「破砕・切断機」：破砕機・切断機・粉砕機。
- 根拠の書き方は v0 と同じ（公の出典なら `title`・`issuer`・`url`・`state`、`照合済` なら確かめた所を `checked` に。出典が無ければ `ownReason`）。`照合済` は、このセッションでその頁か法令の本文を実際に取って、その語が載っていることを確かめたときだけ。候補（確かめてから使う）：大気汚染防止法施行令の別表第一（廃棄物焼却炉）、ダイオキシン類対策特別措置法施行規則（集じん器）、電気設備に関する技術基準を定める省令（発電機）、廃棄物の処理及び清掃に関する法律施行令（破砕施設）。どれも e-Gov で取れる。
- `note` を「20 種を平らに持つ」に直し、v1 で 4 種を足した理由（上の運営者の決定）を 1 文足す。

## 2. ごみ焼却の 1 段目の当てはめを直す

- `packs/waste-incineration/common.json` で、いま `kind: null` の 27 項目のうち、新しい 4 種に当たるものは `kind` をそのコードにし、`kindReason` を消す。当たらないものは `null` と理由のまま（理由が「16 種に無い」なら「20 種に無い」に直す）。
- いま `kind` がある 8 項目は変えない。ほかの欄・順・書き方（2 文字の字下げ、1 項目 1 行）を変えない。

## 3. 試験 `tests/packs/kinds.test.mjs` を直す

- 種類の数を 20 にし、名前の順の一致を「§2.1 の 16 種のあとに、炉・集じん装置・発電機・破砕・切断機」にする。
- ほかの確かめ（コードの形と一意、根拠の形、35 項目の kind か kindReason、使うコードがあること）はそのまま。

## 済んだと言える条件

- `node --test tests/packs/kinds.test.mjs`、`node scripts/run-tests.mjs`、`node scripts/check-publish.mjs` が通る。
- report.md に、4 種それぞれの根拠の種類と確かめ方、当てはめが変わった項目の数と一覧、まだ `null` の項目と理由、未確認のことを書く。
