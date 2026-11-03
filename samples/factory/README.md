# サンプルの工場（v0）

架空のごみ焼却施設 1 つ（ストーカ式 2 炉）の「正解の世界」を組み、そこから現場の形の汚い資料を 2 つ書く。設計は `docs/plan.md` §2.5。

**すべて架空。** 施設・事業者・数値はすべて作りもの。どのファイルにも「【架空】」を入れてある（表題のセルと作成者の欄）。

## 作るもの

- `samples/out/waste-incineration/fictional-1/plan-hoshitori.xlsx` 星取表（2 段の見出し、和暦と西暦の混在、縦の結合、〃、凡例に無い記号 1 つ、数の値の小計）
- `samples/out/waste-incineration/fictional-1/daily-report.csv` 作業日報（Shift_JIS、CRLF、半角カナ、まとめ工事、工数の書き方の揺れ）
- `samples/truth/.../` 正解（`world.json`、資料ごとの `*.truth.json`）。**試験だけが読む。AI には渡さない。**
- `samples/facts/.../plan-hoshitori.facts.json` 書いた xlsx を openpyxl で読み直した原本の事実（物差し ① の材料）

## 走らせ方

```
python3 -m venv /tmp/venv && /tmp/venv/bin/pip install -r samples/factory/requirements.txt
/tmp/venv/bin/python -I -X utf8 samples/factory/build.py          # 全部を作り直す
cd samples/factory && /tmp/venv/bin/python -I -X utf8 -m unittest discover -s tests -t .
```

もう一度走らせると、全ファイルが同じバイト列になる（乱数の種と「今日」＝2026-10-01 を固定。zip の日時も固定）。

## 構成

- `world/` 正解の世界。`rules.json`（作業の組み方・欠け・汚しの決まり。数はここだけ）と `build_world.py`
- `writers/` 資料の書き手
- `dirt/` 汚さの部品（和暦、〃、半角カナ、括弧、工数の書き方）
- `tests/` 試験

## v0 の範囲

機器台帳・工事報告書の PDF・写真・2 つ目の施設・し尿処理は、まだ作っていない。
