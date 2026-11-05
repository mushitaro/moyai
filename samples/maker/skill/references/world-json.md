# パックの world.json（世界の決まり）の形

`packs/<業種>/world.json`。生成器（`samples/maker/world.py`）が読む、業種ごとの決まりです。業種の語はここにだけ置きます。手本は `packs/waste-incineration/world.json`（炉の窓がある業種）と `packs/night-soil/world.json`（全停止だけの業種）です。

## 上の段

| 項目 | 中身 |
|---|---|
| `schema` | `"moyai.world/0"` |
| `pack` | パックの名前（フォルダ名と同じ） |
| `version` | 決まりの版。中身を変えたら上げる |
| `note` | 何の決まりか。未確認のことはここに書く |
| `fiscalYearStartMonth` | 年度の始まりの月（4） |
| `rates` | 割合（下） |
| `outage` | 休止の窓と組み方（下） |
| `legal` | 法令の点検（下） |
| `systems` | 設備の分類（下） |
| `commonKinds` | 「共通」の 3 つの意味の言葉（`shared_part`・`junction`・`facility`） |
| `catalog` | 機器と作業（下） |
| `outageRows` | 炉全体の定期整備と全休炉の行の書き方（`furnace.w`・`all.w` の言い方の候補と属性）。窓の無い業種は無くてよい |
| `upgrade` | 基幹改良（3 年度にまたがる 1 件の契約）。`title`・`years`・`items`（機器の key）・`md`・`amountYen`・`v` |
| `breakdowns` | 事後の補修の言い方。`[{for: [機器の key], w: [言い方]}]` |
| `routine` | 日報にだけ書く細かな点検。`items: [{for, w}]`・`vendor`・`contract`（結ぶ契約。`annual:om` など） |
| `vendors` | 業者の役 → 架空の名前の候補。役の名前は `catalog[].tasks[].v` と `spec.maker` から引く。`plant`（元請・窓の段の既定）と `om`（運転管理）は、どの業種にも要る。`repair.default` の役も要る |
| `annualContracts` | 年間の委託（下） |
| `purchases` | 単価契約の購入。`[{title, v, yen: [下, 上]}]` |
| `naming` | 号炉・号機・共通の書き方（下） |
| `manDaysText` | 工数の書き方の候補（`人日`・`人工`・`延べ人数`・`時間`・`日数`・`期間`） |
| `chartHealth` | 機器別管理基準の健全度の段（`scale: [1,2,3,4]`）。使う業種だけ |

## rates（割合）

施設ごとの乱数で当てます。施設の設定の `rates` で、施設ごとに上書きできます。

- 正解の `errata` に 1 件ずつ記録されるのは、`omitMark`・`wrongYear`・`lastYearReflected` の 3 つです。
- `postpone`・`partial`・`unplannedExtra`・事後の補修は、作業の `status` に出ます。

| 項目 | 意味 | ごみ焼却の値 |
|---|---|---|
| `omitMark` | 星取表の実績の書き漏れ | 0.03 |
| `wrongYear` | 星取表の年度の書き間違い（隣の年度に印） | 0.04 |
| `lastYearReflected` | 「今日」の年度の実績が星取表に載る割合 | 0.5 |
| `breakdownInChart` | 事後の補修が星取表に載る割合 | 0.12 |
| `postpone` | 計画した作業の延期（「○→」） | 0.06 |
| `partial` | 一部だけの実施（△） | 0.03 |
| `unplannedExtra` | 計画外の臨時の実施 | 0.02 |
| `breakdownPerUnitYear` | 1 台 1 年あたりの事後の補修の起きやすさ | 0.035 |
| `diaryRoutinePerDay` | 日報にだけある細かな点検の 1 日あたりの数 | 1.4 |
| `cycleAsText` | 周期を「1年」と文字で書く行 | 0.18 |

## outage（休止の窓）

| 項目 | 中身 |
|---|---|
| `startMonthDay` | 窓の始まりの幅 `[[月, 日], [月, 日]]` |
| `allDays` | 全休炉（全停止）の日数の幅 |
| `steps` | 各炉の窓の段。`{key, name, days, md, vendor}`（`vendor` の既定は `plant`）。`key: "work"` の段が機器の整備で、`days: null`（作業から決まる）。その前が窓の前の段、あとが窓のあとの段 |
| `flow.inner` | 炉内の作業の順（上流から下流）。`catalog[].tasks[].flow` と同じ名前。同じ流れの中で作業場を重ねない |
| `flow.outerParallel` | 読まれていない。実際は、炉外の作業のうち元請（`plant`）の班だけが炉内と並行し、専門の業者は、その業者の炉内の作業に続けて 1 回のつながった期間にする（`world.py` の `_lay_furnace`） |
| `allOutage.blackoutAt` | 全停電の日を、全休炉の何割の所に置くか（0.5 で中ほど） |
| `allOutage.afterBlackout` | 読まれていない。全停電の日から始める作業は、作業の `at` の `B`（その日から）と `D`（次の日から）で決める |

窓の無い業種も、`startMonthDay`・`allDays`・`steps`・`flow.inner`・`allOutage.blackoutAt` は省けません（無いと落ちる）。し尿処理のように、`steps` を `[{key: "work", name: "機器整備", days: null}]` の 1 段にし、`flow.inner` を空（`[]`）にし、`blackoutAt` を 0.0 にします。

## legal（法令の点検）

`{key, name, cycle | perYear, level, source, basis}`。

- `level` は `requirement`（原本で照らした）・`recommendation`（通知などが出どころ）・`app`（照らしていない。アプリの既定）のどれかです。
- `source` は `sources.json` の出典の ID、`basis` は根拠の文です。照らしていなければ「未確認」と書きます。
- 作業の側から `catalog[].tasks[].legal` でこの key を指します。

## systems（設備の分類）

`{key, chart: [呼び名], ledger: 台帳での名前, electrical}`。

- `chart` の何番目を使うかは、施設の設定の `sysVariant` で選びます。呼び名は **3 つ以上** 書きます（`chart.py` は 3 で割った余りで選ぶ）。
- `electrical: true` の設備は、施設の設定の `elecSheet` で電気・計装のシートに分かれます。
- `key: "FAC"` の節（`ledger: null`）を置きます。施設全体の共通の機器（`catalog[].sys` が `FAC`）は、星取表の頭の「施設全体」の下に入ります。

## catalog（機器と作業）

1 つが機器の型です。施設の性質と台数から、1 台ずつ（部位も）の機器になります。

| 項目 | 中身 |
|---|---|
| `key` | 機器の型の名前（英大文字）。作業・業者・日報・写真の設定から指す |
| `sys` | `systems` の key |
| `name` | 台帳の名前 |
| `chart`・`diary` | 星取表・日報での呼び名の候補（半角カナも入れる） |
| `class` | パックの `common.json` の項目のコード |
| `scope` | `furnace`（号炉ごと）・`junction`（系統が合流して分かれる機器）・`shared_part`（系統に共通の部品）・`facility`（施設全体） |
| `commonKind` | 「共通」の意味を scope と違えるとき |
| `n` | 台数（号炉ごとなら 1 炉あたり） |
| `tag` | 機器番号の頭（施設の設定の `tagStyle` で `IDF-1` か `IDF-101` に） |
| `need` | 施設の性質の条件。`{furnace: ["STOKER"], turbine: [true]}` など。合わない施設には作らない |
| `parts`・`partsPerFurnace` | 部位（クレーン → 巻上装置・走行装置…）。号炉ごとに部位を持つか |
| `under` | 星取表で、ほかの機器の下に入れる（制御装置をクレーンの下に） |
| `addedYearOffset` | 竣工から何年あとに足した機器か（完成図書に載らない） |
| `noLedger` | 機器台帳に載せない |
| `spec` | 完成図書の仕様（`form`・`main`・`kw`・`maker`＝業者の役） |
| `chartRow` | 星取表の行の持ち方。`unit`（1 台ずつ）・`pair`（2 炉で 1 行）・`group`（まとめて 1 行。日報でも同じ日の作業を 1 行にまとめる） |
| `tasks` | 作業（下） |

`ownTasks`・`work`・`nameWithFurnace` は、いまのコードでは読んでいません（書いてあっても効きません）。

### tasks（作業）

| 項目 | 中身 |
|---|---|
| `w` | 作業の文字 |
| `a` | 作業の属性：`INSPECT`・`OVERHAUL`・`REPLACE`・`UPGRADE` |
| `c` | 周期（年） |
| `perYear` | 1 年に何回か（排ガス測定の 4 など） |
| `k` | 1 回の費用（千円） |
| `md`・`d` | 工数（人・日）と工期（日）の幅 |
| （`c` の注意） | `perYear` の作業でも `c` は要る（位相を `c` で決めるため。毎年なら 1） |
| `at` | いつ行うか（下） |
| `flow` | 炉内の流れのどこか（`outage.flow.inner` の名前）。炉外は無し |
| `v` | 業者の役（`vendors` の key） |
| `ct` | 契約の持ち方：`own`（単独の工事）・`bundle`（まとめた定期補修工事）・`annual:<key>`（`annualContracts` の key の年間の委託） |
| `legal` | `legal` の key |
| `p` | 部位の作業なら部位の名前（`parts` の 1 つ） |
| `once` | `"added"`：足した年に 1 回だけ |

`at` の値：

| 値 | いつ |
|---|---|
| `F` | その号炉の定期整備の窓 |
| `A` | 全休炉の始めから |
| `B` | 全停電の日から |
| `D` | 全停電の次の日から（DCS など） |
| `Y` | 窓の外の、年度のいつか（平日） |
| `M`・`Q`・`H` | 毎月・四半期・半期。月は作業の何回目かの順に取るので、`perYear` を 12・4・2 に合わせる |

事後の補修（`X`）と日報だけの点検（`R`）は、生成器が `breakdowns` と `routine` から作ります。

## annualContracts（年間の委託）

`{key, title, v, method: [契約の方法], yen: [下, 上], kind}`。

- `title` の `{fac}` は、施設の名前に置き換わります。
- `key` は、作業の `ct: "annual:<key>"` から指します。指す作業が無い年は作りません。
- `always: true` の委託（運転管理の `om`）は、作業が無くても毎年作ります。日報にだけある点検は、`routine.contract` の契約に結びます。
- `titleIf: {axis, value, title}` は、施設の性質がその値のときに件名を替えます（ごみ焼却の O&M の「運営業務（長期包括）」）。

`purchases` の `oneOff: true` は、毎年ではなく半分ほどの年に随意契約で買う物です。`needAsset: "<機器の key>"` は、その機器がある年だけ買う物です（活性炭供給装置のある年の活性炭）。

## naming（書き方）

- `furnace.chart`・`furnace.diary`・`furnace.order`：号炉の書き方の候補。`{n}` は数、`{nz}` は全角の数。
- `unit.chart`・`unit.diary`：号機の書き方の候補。`{A}` は A・B・C…（10 台を超えると数）。
- `common.chart`・`common.diary`：「共通」の書き方の候補。

何番目を使うかは、施設の設定の `furnaceStyle`・`unitStyle`・`commonStyle` で選びます（references/facility-json.md）。個数の下限があります。`furnace.chart` は 3 つ以上、`common.chart` は 2 つ以上書きます（既定でその番号を使うため）。水処理の業種は「号炉」の場所に系列を入れます（`{n}系`・`{n}系列`）。

## 業種の言葉（text）

資料・README・user.md に出る業種の言葉です。コードはここからしか業種の言葉を引きません。無い言葉を使うと、名前を言って止まります。手本は `packs/waste-incineration/world.json`（号炉）と `packs/night-soil/world.json`（系列）です。

| 項目 | 何に使うか | ごみ焼却 | し尿処理 |
|---|---|---|---|
| `unit` | 系列 n の正式な書き方（契約の件名・台帳・写真・日報の運転の欄・管理基準） | `{n}号炉` | `{n}系` |
| `unitWord`・`theUnit` | 説明の文の中の言葉 | 号炉・その炉 | 系列・その系列 |
| `allUnits` | 全部の系列（日報の機器の欄、仮の機器の名前） | 全炉 | 全系列 |
| `pairRow` | 2 系列で 1 行にした行の言い方（2 系列以上の施設だけ） | 2 炉で 1 行 | 2 系列で 1 行 |
| `chartTop`・`chartUnitsAll`・`chartHeads` | 星取表の頭の節・系列全体の節・列の見出しの既定（施設の設定で上書きできる） | | |
| `upgradeMemo` | 基幹改良のセルのメモ（`{y0}`・`{y1}`・`{y2}`） | | |
| `taskUnit`・`taskAll` | 系列の定期整備と全停止の作業の名前 | 定期整備・全休炉整備 | |
| `contractUnit`・`contractAll` | まとめた工事の件名（`{fac}`・`{unit}`） | | |
| `ganttUnit`・`ganttAll`・`ganttAllSingle` | 工程表の見出しの行 | | |
| `diaryHeadPortrait`・`diaryHeadLandscape` | 日報の明細の見出し（A4 縦・横） | | |
| `diaryStatusExtra` | 日報の運転の欄に足す項目 `{axis, label}`。無ければ null | 発電（turbine） | null |
| `csvUnitHead` | 作業実績の CSV の系列の列の見出し | 号炉 | 系列 |
| `specPerUnit` | 完成図書の「1 系列あたり」 | 1炉あたり | |
| `doc.sourceNotes` | README の「出典と加工」の行 | | |
| `doc.words`・`doc.userFacility` | user.md の「うちの施設」の文。下に書き方 | | |
| `doc.diaryExample`・`diaryForms`・`routineExample`・`ganttShade`・`ganttHeads`・`partsExample`・`specNamesExample`・`ledgerCodeExample` | README と user.md の例 | | |

`doc.userFacility` は文の並びです。

- 各文は `{t, when}` です。`when` は無し・`upgrade`（基幹改良のある施設だけ）・`noUpgrade` のどれかです。
- `t` の中では次の名前が使えます。
  - `{p[軸]}`：施設の性質
  - `{w[軸]}`：`doc.words[軸]` で性質の値を言葉にしたもの（`"*"` は、そのほかの値）
  - `{F}`：系列の数
  - `{total}`：`profileAnswer.total` の値 × 系列の数
  - `{up0}`・`{upN}`：基幹改良の始めと終わりの年度

## profileAnswer・trades・repair・specCount

| 項目 | 中身 |
|---|---|
| `profileAnswer` | `copy`（そのまま残す軸）、`total`（`{from, key, band: {key, edges, names}}`。1 系列あたりの値 × 系列の数と、その帯）、`yesNo`（真偽を YES・NO にする軸）。無ければ、施設の profile の軸をすべて残す |
| `trades` | `names`（職種）、`byRole`（業者の役 → 職種ごとの重み）、`default`。日報の A4 横の帳票を使う施設に要る |
| `repair` | `own`（事後の補修を自分でする業者の役）と `default`（ほかの機器の補修の役） |
| `specCount` | 完成図書の数量の単位。`default`・`bySuffix`（名前の終わり）・`byKey`（機器の key）。無ければ「台」 |

## コードが読んでいない項目

次の項目は、書いてあっても効きません。決まりの説明として残していますが、これに頼って様式を変えようとしないでください。効かせたいときは、コードを直します（業種の語をコードに入れない形で）。

- 上の段：`commonKinds`・`manDaysText`・`chartHealth`
- `outage`：`steps[].alias`・`flow.outerParallel`・`allOutage.afterBlackout`
- `upgrade.md`（基幹改良の工数は、1 台あたり 40〜80 人・日に決め打ち）
- `catalog`：`ownTasks`・`work`・`nameWithFurnace`
