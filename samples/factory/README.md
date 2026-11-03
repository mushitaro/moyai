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

正解（試験だけが読む。AI には渡さない）：`samples/truth/.../` の `world.json`、資料ごとの `*.truth.json`、`crossdoc.truth.json`（どの資料のどの行が同じ作業か。星取表のセル・報告書の表の行・日報の行・台帳の行・写真の印）。`samples/facts/.../` は書いた xlsx を openpyxl で読み直した原本の事実。

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

機器台帳・工事報告書・写真・2 つ目の施設は作った。し尿処理の施設と、plan §2.5 の厚さ（機器が数百、作業が千を超える）は、まだ作っていない。fictional-1 の機器は 25、作業は 191。
