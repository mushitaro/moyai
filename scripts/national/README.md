# 全国の表から数だけを取り出す道具（v0）

全国の表（xlsx）から、稼働の施設の軸の値だけを取り出し、軸の値の組ごとの施設の数をパックの `national/table.json` に書く。設計は `docs/plan.md` §2.7・§2.8。

- 施設名・地方公共団体・所在地・コードは持たない。1 施設ごとの行は出さない。
- 元の表はリポジトリに入れない。既定では一時のフォルダに取り、読んだら消す。
- 列の名前と軸への読み替えは、パックの `national/columns.json` に書く。業種の語はコードに置かない。パックを足すときは columns.json を足し、コードは足さない。
- 決まらないセルがあれば、数を添えて止める（table.json を書かない）。標準エラーには数と列の名前だけを書き、行の値は書かない。
- 書く前に、持たない列（columns.json の `withhold`）の値が、書き出すものに出ていないかを照らす。出たら止める。

## 走らせ方（リポジトリの根で）

```
python -I -X utf8 scripts/national/build.py --pack packs/waste-incineration
python -I -X utf8 scripts/national/build.py --pack packs/waste-incineration --xlsx <手元の表> --retrieved YYYY-MM-DD
python -I -X utf8 -m unittest discover -s scripts/national -t .
```

- openpyxl は `samples/factory/requirements.txt` の版（3.1.5）を使う。
- `--edges 50,100,200,400` で帯の境目を外から渡せる（無ければ columns.json の `edges`）。帯は下の端を含み、上の端を含まない。
- 表の SHA-256 が `sources.json` と違えば止める。表が差し替わったら、人が sources.json を照らし直してから走らせる。
- columns.json を直したら、table.json を作り直す（table.json は columns.json の SHA-256 を持ち、試験が照らす）。

## columns.json の形（`moyai.national-columns/0`）

| 欄 | 中身 |
|---|---|
| `sheet`・`header` | シートの名前と、見出しの段（`first`〜`last` 行目） |
| `rowKey` | 値があれば施設の行と数える列 |
| `withhold` | 持たない列。書き出すものに値が出ていないかを照らす |
| `status` | 改廃の列。空なら稼働。空でなければ群の語で分ける |
| `axes` | 軸。`kind` は `map`（値か値の頭で読み替え）・`band`（数を帯に）・`contains`（語を含むか）・`parts`（複数の列を分けて、先に当たる決まりの順で読む） |
| `steps` | 紛れる数を数える段（軸を足していく順） |

列は見出しの名前で探す。見出しは段を上から並べ、結合を広げ、同じ語が続けば 1 つにしたもの。NFKC にして空白を除いて比べる。

## table.json の形（`moyai.national-table/0`）

出典（取得日・SHA-256・「加工した」こと）、数え方の文、施設の数（`population`）、軸のコード、セルの行き先の数（`cells`）、軸の値の組ごとの数（`rows`）、紛れる数（`k`）、名前の照らし（`nameCheck`）。
