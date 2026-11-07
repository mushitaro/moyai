# サンプルの工場（v1）

架空のごみ焼却施設 2 つ（fictional-1 はストーカ式 2 炉、fictional-2 は流動床式 1 炉）の「正解の世界」を組み、そこから現場の形の汚い資料を書き分ける。設計は `docs/plan.md` §2.5。

**すべて架空。** 施設・事業者・数値はすべて作りもの。どのファイルにも「【架空】」を入れてある（表題のセルと作成者の欄）。

## 作るもの

fictional-1（資料 5 種）。`samples/out/waste-incineration/fictional-1/` の下：

- `equipment-ledger.xlsx` 機器台帳（字下げだけの 1 列で 3 段、番号 1 / 1-1 / 1-1-1、名前の中の機器番号「誘引通風機（IDF-1）」、セルの中の改行、取替・撤去を備考に）
- `plan-hoshitori.xlsx` 星取表（2 段の見出し、和暦と西暦の混在、縦の結合、〃、凡例に無い記号 1 つ、数の値の小計）
- `reports/report-f<号炉>-fy<年度>.xlsx` と `.pdf` 定期整備の工事報告書（帳票。頁ごとに見出しをくり返し、2 頁目から「（続き）」。工数と工期。合計は数の値）。PDF は xlsx を LibreOffice の headless で変換して作る
- `daily-report.csv` 作業日報（Shift_JIS、CRLF、半角カナ、まとめ工事、工数の書き方の揺れ）
- `photos/inspection-photo-f<号炉>-fy<年度>.jpg` 日常点検表の写真。報告書の PDF の 1 頁を画像にし、傾き・影・ぼけ・手書きの丸とチェックを足す（長辺 1,800px、約 100KB）

精密機能検査は、星取表（◎）と工事報告書（「精密機能検査 実施記録」の行）に書き分け、日報（2022 年度以降）にも出る。

fictional-2（機器台帳と星取表）。`samples/out/waste-incineration/fictional-2/` の下。fictional-1 と段の数と呼び名を変えてある：

| | fictional-1 | fictional-2 |
|---|---|---|
| 星取表の段 | 2（設備／機器） | 4（設備／系統／機器群／機器） |
| 機器台帳の段 | 3、番号あり、設置年は西暦 | 4、番号なし、設置年は和暦の文字 |
| 呼び名 | 誘引通風機（IDF-1） | IDF 誘引送風機 |

施設の名前は造語（地名に見えないもの）。仕様の数値・設置年・工数はすべて作りもの。

fictional-ns-1（し尿処理の架空の 1 施設。機器台帳・星取表・作業日報の 3 種）。`samples/out/night-soil/fictional-ns-1/` の下。ごみ焼却と同じ厚さのふりをしない：機器は 40、作業は 292、報告書・PDF・写真は作らない。

- 機器の名前と記号（`NS.…`）は `packs/night-soil/common.json` の項目だけから選ぶ。水処理の 2 系列（1系・2系）が、焼却の炉の役をする（`rules-fictional-ns-1.json` の `facility.furnaces`。名前の「furnaces」は「同じ設備を並べて持つ単位」の意味で、データだけで系列に当てた）。
- 星取表と日報の列の見出しは、`facility.line_header`（「系列」）で決める。書かなければ「号炉」。
- 星取表は 2 段（設備／機器）。機器台帳は 3 段、番号あり、設置年は和暦の文字、名前の中の機器番号は角括弧。
- 生成器のコードは、見出しの語と施設の一覧（`build.py` の `RULES_FILES`）を足しただけ。作業の組み方・欠け（4 件）・汚しはすべて `rules-fictional-ns-1.json`。

正解（試験だけが読む。AI には渡さない）：`samples/truth/.../` の `world.json`、資料ごとの `*.truth.json`、`crossdoc.truth.json`（どの資料のどの行が同じ作業か。星取表のセル・報告書の表の行・日報の行・台帳の行・写真の印）。`samples/facts/.../` は書いた xlsx を openpyxl で読み直した原本の事実。CSV の事実は `csv_facts.py`（Python の csv で、書き手が宣言した文字コードで読み直す）が書く：

```
python -I -X utf8 samples/factory/csv_facts.py samples/out/waste-incineration/fictional-1/daily-report.csv cp932 , samples/facts/waste-incineration/fictional-1/daily-report.facts.json
```

## LibreOffice が無いとき

PDF と写真は作らない。`build.py` が、作れなかった PDF と写真の数と理由を標準エラーに出す（`--no-pdf` でも同じ）。xlsx・CSV・正解・事実は、LibreOffice が無くても同じに作れる。PDF と写真は、LibreOffice・字体・画像の部品の版で変わりうるので、コミットした出力との照合（試験）には入れない。

## 走らせ方

```
python3.12 -m venv /tmp/venv && /tmp/venv/bin/pip install -r samples/factory/requirements.txt
/tmp/venv/bin/python -I -X utf8 samples/factory/build.py          # 全部を作り直す（LibreOffice があれば PDF と写真も）
cd samples/factory && /tmp/venv/bin/python -I -X utf8 -m unittest discover -s tests -t .
```

もう一度走らせると、全ファイルが同じバイト列になる（乱数の種と「今日」＝2026-10-01 を固定。zip の日時も固定）。

## 構成

- `world/` 正解の世界。`rules.json`（作業の組み方・欠け・汚しの決まり。数はここだけ）と `build_world.py`
- `writers/` 資料の書き手
- `dirt/` 汚さの部品（和暦、〃、半角カナ、括弧、工数の書き方）
- `tests/` 試験

## 今の範囲

機器台帳・工事報告書・写真・2 つ目の施設・し尿処理の 1 施設は作った。fictional-1 は plan §2.5 の厚さにした（運営者の決定で P2 のあと、2026-11-04）：機器 217・作業 2,258（点検 2,017・分解整備 224・取替 16・基幹改良 1）・外注先 4 社・外注先と作業の型と年度の組 250、10 年分（2019〜2028 年度）。

- 足したのは、パックの共通の設備項目の下に並ぶ補機（ボイラ給水ポンプ・スートブロワ・煙道ダンパ・低圧動力盤など）と、それを受け持つ作業の型。どの機器も、パックの項目のどれかに当たる。
- 同じ機器を複数台置くときは、ひな形の `units`（A・B…）で書く。名前と機器番号の両方に号機の字を入れる（「ボイラ給水ポンプ A」「BFP-A1」）。資料をまたいで同じ機器を見分けられるようにするため。機器番号は、号機の字のあとに炉の番号を書き、末尾の数が炉の番号になるようにする（読み手は末尾の数で炉を見分ける）。
- どの機器にも、計画の窓（2026〜2028 年度）に予定が入るようにした。入れた欠け（6 つ）は変えていない。
- 工事報告書に載せる作業の型は、前のまま（定期整備・精密機能検査・排ガス処理設備の点検・通風機の分解整備）。

動画の撮り直し用の世界（ほたる川クリーンセンター。ストーカ式 2 炉、令和 6〜8 年度、機器台帳・星取表・作業日報の 3 種）は `world/rules-hotarugawa.json` だけで作る。通常の作り直しには入れない（`build.py --rules rules-hotarugawa.json` か `video_world.py`）。置き場所は `video/world/hotarugawa/`（`video/world/README.md`）。呼び名を替えた機器は 火格子・バグフィルタ・誘引送風機・蒸気タービン。

公開の台帳のデモの架空の 10 施設（`ledger_worlds.py`）は、厚くする前の決まり `world/rules-ledger-base.json` を土台にする。本物の台帳のリポジトリに載せた束と、リポジトリの正解の世界を食い違わせないため。
