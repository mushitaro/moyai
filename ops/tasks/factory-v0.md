---
id: factory-v0
role: factory
agent: factory
environment: env-factory
budgetUsd: 12
timeoutMin: 90
verify: ["cd samples/factory && {python} -I -X utf8 -m unittest discover -s tests -t .", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 工場 v0：架空のごみ焼却施設 1 つと、資料 2 つ

`docs/plan.md` §2.5（サンプルの工場）を読んでから作る。今回はその最初の小さな版（v0）。

## 道具

- Python 3.12 と、`samples/factory/requirements.txt` の版（openpyxl 3.1.5、Pillow 13.0.0、pypdfium2 5.14.0）。`python3 -m venv /tmp/venv && /tmp/venv/bin/pip install -r samples/factory/requirements.txt` で入れる。サンドボックスの Python が 3.12 でなければ、あるもので作り、版を report.md に書く（3.12 の構文と標準ライブラリだけを使う）。
- requirements.txt は変えない。ほかの依存を足さない。
- Python は `python -I -X utf8` で走らせる。`-I` では台本のフォルダが `sys.path` に入らないので、入口の台本は自分のフォルダを `sys.path` の頭に足す。

## 作るもの

置き場所は §2.5 のとおり。施設のフォルダの名前は `fictional-1`。

```
samples/factory/README.md            短い説明（何を作るか、走らせ方、正解は試験だけが読むこと、すべて架空）
samples/factory/build.py             入口。python -I -X utf8 samples/factory/build.py で全部を作り直す
samples/factory/world/               正解の世界（world.json の決まりと、そこから世界を組むコード）
samples/factory/writers/             資料の書き手（星取表の Excel、作業日報の CSV）
samples/factory/dirt/                汚さの部品（和暦、〃、半角カナ、括弧の揺れなど）
samples/factory/tests/test_*.py      試験（cd samples/factory && python -I -X utf8 -m unittest discover -s tests -t .）
samples/out/waste-incineration/fictional-1/plan-hoshitori.xlsx
samples/out/waste-incineration/fictional-1/daily-report.csv
samples/truth/waste-incineration/fictional-1/world.json      世界そのもの（機器・作業・欠け）
samples/truth/waste-incineration/fictional-1/plan-hoshitori.truth.json
samples/truth/waste-incineration/fictional-1/daily-report.truth.json
samples/facts/waste-incineration/fictional-1/plan-hoshitori.facts.json
```

生成したファイル（out・truth・facts）もパッチに入れる（コミットする決まり）。

## 正解の世界

- 架空のストーカ式 2 炉（1 号炉・2 号炉）のごみ焼却施設 1 つ。名前は架空とわかるものにし、実在の施設・自治体・事業者の名前を使わない。
- 機器は 20〜30。どの機器も `packs/waste-incineration/common.json` の項目のコード（`WI.` で始まる。ストーカ式の型の項目を使う）に当てる。炉ごとの機器（1 号炉と 2 号炉で別の行）と、共通の機器の両方を入れる。正解に、機器 → 項目のコードの対応を書く。
- 年度は 10 年度（2019〜2028 年度）。物語の「今日」は 2026-10-01 に固定する。今日より前は実績、後は予定。2026 年度は実績と予定の両方がある。
- 作業は、機器・年度・作業の属性（`INSPECT`・`OVERHAUL`・`REPLACE`・`UPGRADE` のどれか。`packs/_kinds/work.json`）・始めと終わりの日・工数（人・日）・日数（工期）を持つ。号炉ごとの定期整備、全休止の期間、精密機能検査、基幹改良を 1 件は入れる。作業の組み方の決まりは `world.json` に持ち、コードに数を埋めない。
- 乱数の種を固定する（`world.json` に書く）。
- 計画の欠けを 5 件以上入れる。検査の ID の小さな一覧（3〜6 個。ID・一行の説明）を `world.json` に持ち、どの欠けもどれかの ID にひもづける。例：精密機能検査の間が 3 年を越える（`packs/waste-incineration/sources.json` の通知、第三の 11）、過去の予定に実績が無い、計画の窓に予定が 1 つも無い機器。欠けの一覧（ID・機器・年度・何が欠けているか）を正解に書く。

## 資料 1：星取表の Excel（plan-hoshitori.xlsx）

- 1 枚目のシートに星取表。左に大分類（設備）・機器・号炉の列、右に年度の列。
- 見出しは 2 段：上の段が年度（2 列を結合）、下の段が「実績」「予定」。
- 年度の見出しは和暦と西暦を混ぜる（例：H31、R1、令和2年度、2021年度）。平成 31 年と令和元年の切り替えを 1 か所入れる。
- 大分類の列は、同じ設備の行を縦に結合する。号炉か作業の区分の列で、上と同じ値を「〃」で書く行を入れる。
- 記号は ○（予定）・●（実績）・◎（精密機能検査）など。表の下に凡例を置く。表の中で 1 つだけ、凡例に無い記号を使う（どの記号をどのセルに使ったかを正解に書く）。
- 年度ごとの件数の小計の行を、数の値で書く（数式にしない）。
- 表題のセル（A1）に「【架空】」を入れる。ファイルの作成者の欄（`wb.properties.creator`）にも「【架空】」を入れる。
- 正解（plan-hoshitori.truth.json）：見出しの行、どのセルがどの作業か（作業の ID）、凡例、凡例に無い記号の場所、小計の行。

## 資料 2：作業日報の CSV（daily-report.csv）

- Shift_JIS（cp932）、改行は CRLF。委託先の業務の仕組みから書き出した形。
- 頭に表題の行（「【架空】」を含む）と作成者の行（「【架空】」を含む）を置き、その下に見出しの行と 1 日 1 行の記録。
- 半角カナ、括弧の全角と半角の混在、複数の機器をまとめた工事の行を入れる。工数の書き方を揺らす（人・日、人工、延べ人数、時間）。
- 正解（daily-report.truth.json）：見出しの行の番号、どの行がどの作業か、工数を人・日に直した値。

## 原本の事実（facts）

- 書いた xlsx を openpyxl で読み直し、シートごとに、空でないセルの座標・値・型（`data_type`）・表示形式、結合の範囲、隠した行と列を JSON に書く（plan-hoshitori.facts.json）。MOYAI の読み手と比べる物差し ① の材料になる。

## 同じものが出ること

- もう一度走らせると、全部のファイルが同じバイト列になる。openpyxl が入れる作成と更新の日時は物語の今日に固定し、zip の中のファイルの日時も固定する（書いたあとに zip を同じ順・同じ日時で書き直してよい）。JSON は鍵を並べ、UTF-8・LF で書く。
- これを試験で確かめる（2 回作って、ファイルごとの SHA-256 を比べる。作る場所は一時のフォルダ）。

## 試験に入れること

- 2 回作ると同じバイト列になる。
- xlsx の表題のセルと作成者の欄、CSV の表題の行と作成者の行に「【架空】」がある。
- 機器の数が 20〜30、号炉が 2 つ、年度が 10、機器の項目のコードがどれも common.json にある。
- 欠けが 5 件以上あり、どれも world.json の検査の ID にひもづく。
- 星取表に、縦に結合した大分類、「〃」、2 段の見出し、凡例に無い記号が 1 つ、数の値の小計（数式でない）がある。
- CSV が cp932 で読め、半角カナとまとめ工事の行がある。
- facts が、openpyxl で読み直したものと一致する。

## 済んだと言える条件

- 上の試験が全部通る。`node scripts/run-tests.mjs` と `node scripts/check-publish.mjs` も通る。
- report.md に、作ったファイル、試験の件数と結果、Python の版、欠けの件数、未確認のことを書く。
