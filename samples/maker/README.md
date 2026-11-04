# サンプルの作り手（samples/maker/）

架空の施設の保全の資料を、現場の台帳に近い「汚い」形で作り、ファイルごとの正解と世界の正解を書き出す生成器です。運営者の作り手への指示書（v1.0）に従って作りました。読み手（`src/`）のコードは見ていません。読み手が読めそうかどうかではなく、現場にありそうかどうかで形を決めています。

すべて架空です。施設・機器・業者・人名・金額・型式は実在しません。どのファイルにも【架空】があります。

- 考え方の説明：`docs/sample-making.md`
- 作り手の Skill（手順・決まりの形・正解の形・つまずいた所）：`samples/maker/skill/SKILL.md`。新しい業種のサンプルを作るセッションや、施設・様式を足すセッションに、このパスを渡して読ませる。読み手を作るセッションに読まれないよう、`skills/` と `.claude/skills/` には置いていない。

## 置き場所

```
samples/<業種>/<施設>/
  files/                    資料（名前は【架空】で始める）
  user.md                   担当者が知っていること（読み手の質問に答える役が見る）
  README.md                 わざと入れた揺れと食い違いの一覧（作る側と測る人のため）
  answer/files/<stem>.json  ファイルごとの正解
  answer/world.json         世界の正解（機器・作業・契約・結び・書いていない作業・計画の欠け）
  gen/facility.json         施設の設定（性質・資料の組・様式・わざと入れる欠け）
  gen/make.py・check.py     作り直しと自己点検の入口
  gen/evidence/<stem>.json  正解の値が書いてあるセルの番地（check.py が照らす）
samples/maker/              生成器（このフォルダ）
packs/<業種>/world.json      世界の決まり（機器・作業・周期・組み方・呼び名・割合）
```

## 作り直し

```
pip install -r samples/maker/requirements.txt
python samples/maker/facilities.py            # しらかば野（デモ）以外の施設の設定を書く
python samples/maker/make.py samples/waste-incineration/shirakabano
python samples/maker/check.py samples/waste-incineration/* samples/night-soil/*
```

- Python 3.12、openpyxl・reportlab・Pillow・pypdfium2（版は `requirements.txt` で固定）。PDF は reportlab、写真は PDF の頁を pypdfium2 で画像にして Pillow で汚す。日本語の書体は Noto Sans JP。
- 乱数の種と物語の「今日」（2025-12-12）は施設の設定で固定。同じ命令で同じバイト列になる（Excel の zip の時刻と作った日時も固定）。作り直して中身を変えるときは `make.py` の VERSION を上げる。
- 小計と合計は数の値で書く（数式は使っていない）。

## 作りの考え方

1. **正解の世界を先に作る**（`world.py`）。機器を 1 台ずつ（部位も）持ち、毎年の作業を周期と位相から決める。延期・一部だけの実施・計画外の臨時・事後の補修・日報にだけある細かな点検を、世界の割合で入れる。
2. **作業の日付は組み方の決まりから**。毎年 1 号炉の定期整備 → 全休炉 → 2 号炉。各炉の窓は 立下げ → 炉内冷却 → ダイオキシン類の作業前測定・養生 → 付着物除去 → 足場組立 → 機器整備 → 足場解体 → 養生撤去・作業後測定 → 空打ち試運転 → 立上げ。炉内は火格子 → 耐火物 → ボイラ → 減温塔 → 集じん器 → 触媒の順で重ねず、炉外は並行。専門の業者は炉内の作業に続けて 1 回のつながった期間。受変電の全停電は全休炉の中ほどの日で、盤の点検はその日から、DCS はそのあと。
3. **契約を世界から作る**。年間の委託、定期補修工事（まとめた工事）、全休炉の共通設備工事、単独の工事、事後の修繕（緊急の随意契約）、単価契約の購入、継続費の基幹改良、変更契約。
4. **資料はそこから書き分ける**（`chart.py`・`diary.py`・`gantt.py`・`orders.py`・`ledger.py`・`specpdf.py`・`photo.py`）。食い違いはわざと入れたものだけで、すべて正解に記録する。星取表の様式（配置・見出し・凡例・費用の単位・隠す年度・小計）は施設の設定で選ぶ。
5. **業種の語はデータに置く**。機器・作業・周期・呼び名・業者の役・割合は `packs/<業種>/world.json` に置く。し尿処理はデータを足しただけで、コードは同じ。ただし、契約の件名・帳票の見出しの「号炉」「全休炉」と、`doc.py` の README・user.md の文には、まだ業種の語が残っている（`skill/SKILL.md` §4.2「いまの制約」）。3 つ目の業種の前に直す。

## 他業種へ広げるとき

手順の全体は `skill/SKILL.md` の §4.2、`world.json` の項目は `skill/references/world-json.md`。

- `packs/<業種>/world.json` を、同じ形で書く（systems・catalog・legal・vendors・annualContracts・purchases・naming・rates・outage）。機器の `class` はパックの `common.json` の項目のコード。
- 施設の設定（`gen/facility.json`）を書き、`make.py` と `check.py` を走らせる。
- 法令の点検の周期は、原本で照らしたものだけを `requirement` にし、ほかは `recommendation` か `app`。

## 未確認のこと

- し尿処理の施設の性質は、全国の表（08.xlsx）から数をまだ取り出していないので、分布に照らしていない。
- 動画で引く行を人の目で見直すことは、まだしていない。
- Windows の Excel で開いた見た目は確かめていない（LibreOffice の headless では開けた）。
