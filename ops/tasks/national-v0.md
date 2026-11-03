---
id: national-v0
role: dev
agent: dev-core
environment: env-kinds
budgetUsd: 10
timeoutMin: 60
verify: ["python -I -X utf8 -m unittest discover -s scripts/national -t .", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 全国の表から数だけを取り出す道具 v0（ごみ焼却）

`docs/plan.md` §2.7・§2.8（見え方と紛れる数 k）、`packs/waste-incineration/sources.json` の全国の表の行を読んでから作る。全国の表の元のファイルは施設名を含むので、**リポジトリに入れない**（サンドボックスで取り、読んだら捨てる）。

## 1. 道具 `scripts/national/`（Python 3。openpyxl は `samples/factory/requirements.txt` の版）

- 環境省の一般廃棄物処理実態調査結果（令和 6 年度）の施設の表（焼却施設）`https://www.env.go.jp/recycle/waste_tech/ippan/r6/data/seibi/facility/01.xlsx` を取り、SHA-256 を記録する。
- 見出しは 2〜6 行目の 5 段（施設の行は 1,014。施設の改廃が空＝稼働 844）。列は名前で探す（番号で決め打ちしない）。
- 稼働 844 施設のそれぞれについて、次の軸の値だけを取り出す（施設名・地方公共団体・所在地・コードは持たない）：
  - `furnace`：処理方式（ストーカ・流動床・シャフト・回転・固定床・その他。表の書き方からの読み替えを表に書く）
  - `capacity_t_per_day`：施設全体の処理能力（数）。帯は道具の中で決めず、帯の境目（50・100・200・400 t/日）を設定として外から渡して帯のコードに直す。
  - `turbine`：余熱利用の状況に「発電」を含むか
  - `ash`：焼却灰か飛灰のどちらかが溶融なら溶融、そうでなくどちらかがセメント固化ならセメント固化、ほかは搬出
  - `contract`：ごみ処理事業実施方式の ⑦〜⑬（DB+O・DBO・その他公設民営・PFI）なら O&M、ほかは単年度
- 出力 `packs/waste-incineration/national/`：
  - `table.json`：軸の値の組ごとの施設の数（帯にした処理能力を使う。1 施設ごとの行は出さない）。出典・取得日・SHA-256・「加工した」こと・数え方を書く。
  - `columns.json`：表の列の名前と、軸への読み替え（パックを足すときに src を足さないための決まり）。
- 数え直しの結果を出す：稼働 844、休止 118、廃止 22（うち移管 1）、新設 30。炉型 × 能力の帯で 5 施設以上に紛れる割合、＋タービン、＋灰処理、＋運営の形（出典の起点の値：98%（830）・98%（823）・91%（772）・82%（693）と照らし、違えば両方を書く）。

## 2. 試験（unittest、網に出ない）

- 小さな作り物の表（架空の行）で、読み替え・帯・数え方・空の改廃の扱い・見出しの 5 段の読み方を確かめる。
- `table.json` に施設名や地方公共団体の名前が無いこと（元の表の名前の列の値が出ていないこと）。

## 済んだと言える条件

- verify の 3 つが通る。report.md に、数え直しの結果と出典の起点との照らし合わせ、読み替えで迷ったもの、未確認のことを書く。
