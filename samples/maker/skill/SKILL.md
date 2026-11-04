---
name: moyai-sample-maker
description: MOYAI のサンプルの作り手。架空の施設の保全の資料（星取表・作業日報・工程表・発注台帳・機器台帳・完成図書の PDF・点検の CSV・点検表の写真）を、現場の台帳に近い汚い形で作り、ファイルごとの正解と世界の正解（機器・作業・契約・資料をまたいだ結び・書いていない作業・計画の欠け）を書き出す。パックの world.json に業種の決まりを書き、samples/maker/ の生成器で作り、check.py で確かめる。サンプルの施設を足す・作り直す・様式を足す、新しい業種（下水道・上水道・工業用水道・公共建築など）のサンプルを作る、見ていない様式の組を作る、運営者のサンプルへの指摘を直すときに読む。読み手（取り込みのコード・その Skill）を作るセッションは読まない。
---

# MOYAI のサンプルの作り手

あなたは **作り手** です。架空の施設の「正解の世界」を先に作り、そこから現場の形の資料を書き分け、正解を書き出します。考え方の説明は `docs/sample-making.md`、生成器の地図は `samples/maker/README.md` にあります。

運営者の指示書 `C:\Users\kazuh\Downloads\waste_sample\sample-maker.md` を、最初に最後まで読みます。この Skill と指示書が食い違ったら、指示書が勝ちます。指示書と設計書が食い違ったら、設計書が勝ちます。

## 1. 守ること

### 見てよいもの

- 運営者の指示書と見本（`C:\Users\kazuh\Downloads\waste_sample\`）
- 設計書 `C:\Users\kazuh\Downloads\design-prompt (1).md` の §4.2・§4.5・§4.6・§5.2 だけ
- 法令の原本の写し `C:\Users\kazuh\Downloads\sources-seed.md`
- パックの次のファイル：`pack.json`・`common.json`・`sources.json`・`national/`・`world.json`
- `samples/maker/`、`samples/<業種>/<施設>/`、`tests/fixtures/reserved-names.txt`、`AGENTS.md`、公開の統計

設計書と指示書は、リポジトリに写しません。

### 開かないもの

- **読み手：** `src/`、`skills/`、`.claude/skills/`、パックの `SKILL.md`
- **読み手のためのパックのファイル：** 上に挙げたもの以外（`vocab.json`・`checks.json`・`packs/_kinds/`・`packs/_cues/` など）。`common.json` の注記がそれらを指していても、たどりません。
- **前の工場と試験：** `samples/factory/`・`samples/out/`・`samples/truth/`・`samples/facts/`・`samples/heldout/`、`tests/`（`reserved-names.txt` を除く）
- **読み手の作りが書いてある所：** 日誌（`docs/progress/`）の読み手の記録、`docs/plan.md` の取り込みの節。自分の日誌（`*-samples.md`）は読んでかまいません。

形は、読み手が読めそうかどうかではなく、**現場にありそうかどうか** だけで決めます。読み手に合わせた資料は、試験を甘くします。

### 誰に何を渡すか

| 相手 | 渡すもの |
|---|---|
| 読み手 | `files/` だけ |
| 質問に答える役 | `user.md` と `answer/world.json` だけ |
| 測る人 | 試験が終わってから全部 |

`README.md`（わざと入れた揺れの一覧）・`answer/`・`gen/`（`evidence/` を含む）は、読み手に渡しません。

### 架空であること

- 実在の自治体・施設・会社・人の名前、施設 ID、登録番号、公開資料の行の写しは作りません。公開の統計は分布の値としてだけ使い、README に出典と「加工した」ことを書きます。
- **どのファイルにも【架空】を入れます。** ファイル名の頭、Excel は題のセルと作成者、PDF は 1 頁目と文書の情報、CSV は 1 行目、写真は紙の上です。
- **前の製品の名前を書きません。** 見本に書いてある前の製品の名前を、作るファイル・コード・文書に入れません。`node scripts/check-publish.mjs` が落とします。検査のために名前が要るときも、`check-publish.mjs` の FORBIDDEN から読みます（`check.py` がそうしている）。

### 食い違いと業種の語

- **わざと入れた食い違いだけ。** 入れたものは 1 件ずつ正解に記録します。記録していない食い違いは、生成器の誤りです。
- **業種の語はデータに置く。** 機器・作業・周期・呼び名・業者の役・契約・割合は、`packs/<業種>/world.json` に書きます。ただし、今のコードには、ごみ焼却とし尿処理の語が残っています（§4.2 の「いまの制約」）。新しい業種では、まずそれを直します。

### リポジトリの決まり（`AGENTS.md`）

- モデルの識別子を文書・コミットに書きません。
- `git add` はファイル名を指定します。
- 見張りのフックに止められたら、回り道をしません。
- 日誌・報告は日本語で書きます。

## 2. 置き場所

```
packs/<業種>/world.json        世界の決まり（references/world-json.md）
samples/maker/                 生成器
samples/<業種>/<施設>/
  files/                       資料（名前は【架空】で始める）
  user.md                      担当者が知っていること（生成される）
  README.md                    わざと入れた揺れと食い違いの一覧（生成される）
  answer/files/<stem>.json     ファイルごとの正解（references/answer.md）
  answer/world.json            世界の正解
  gen/facility.json            施設の設定（references/facility-json.md）
  gen/make.py・check.py         作り直しと自己点検の入口
  gen/evidence/<stem>.json     正解の値が書いてある番地（check.py が照らす）
samples/unseen/<組>/           見ていない様式の組（§6）
```

## 3. 作り直しの命令

Git Bash で走らせます。PowerShell では `samples/waste-incineration/*` が展開されずに落ちるので、施設のフォルダを並べて渡します。

```
pip install -r samples/maker/requirements.txt          # openpyxl・reportlab・Pillow・pypdfium2（版を固定）
python samples/maker/facilities.py                     # デモ以外の 11 施設の gen/facility.json をすべて書き直す
python samples/maker/make.py samples/<業種>/<施設>       # 1 施設を作る（files・answer・README・user.md・gen）
python samples/maker/check.py samples/waste-incineration/* samples/night-soil/*
node scripts/check-publish.mjs
```

- Python 3.12 を使います。日本語の書体 `C:/Windows/Fonts/NotoSansJP-VF.ttf` が要ります（PDF と写真）。ほかの場所にあるときは、`specpdf.py` と `photo.py` の書体のパスを直します。
- Windows の端末は cp932 です。日本語を出す Python は `sys.stdout.reconfigure(encoding="utf-8")` にするか、ファイルに書いて読みます。
- 乱数の種と物語の「今日」は、`gen/facility.json` で固定します。2 回作って、すべてのファイルの SHA-256 が同じことを確かめます。中身を変えて作り直すときは、`samples/maker/make.py` の `VERSION` を上げます。
- 込み入った Python を Bash のヒアドキュメントで渡すと崩れます。スクリプトはスクラッチのフォルダにファイルで書いて走らせます。

## 4. 仕事の種類ごとの手順

### 4.1 施設を足す（同じ業種）

1. 性質（`profile`）を決めます。
   - 軸と順は、パックの `pack.json` の `profile` に従います。
   - 分布は、全国の表（`national/`）に寄せます。
   - 似た施設の比べ（k ≥ 5）の群は、ごみ焼却ではストーカ・100〜199t/日・タービンあり・搬出・単年度です（`docs/sample-making.md` §7）。その群を崩さないように、どこに入るかを決めます。
2. `samples/maker/facilities.py` の `F` に施設を足します。デモのように手で書く施設は、`gen/facility.json` を直に書きます。そのときは `pack`・`today`・`profile.commissioned` を忘れずに書きます。
3. 資料の組と様式を、ほかの施設と違えます（references/facility-json.md）。
4. わざと入れる計画の欠けを書きます。欠けには、自動で記録されるものと、手で書くものがあります（references/facility-json.md の「欠けの記録」）。手で書くものは `gapsNote` に書きます。
5. `make.py` → `check.py` → `check-publish` の順に走らせます。README の「わざと入れた揺れと食い違い」を読み、入れたつもりのものが載っているかを見ます。
6. `docs/sample-making.md` §7 の施設の数と、日誌の一覧を直します。

### 4.2 新しい業種のサンプルを作る

#### いまの制約（先に直す）

今の生成器は、ごみ焼却とし尿処理の 2 業種で作りました。そのため、次の所に業種の語と決め打ちが残っています。新しい業種でそのまま作ると、資料に「号炉」「全休炉」やし尿処理の文が出ます。

| どこ | 何が残っているか |
|---|---|
| `doc.py`（README・user.md） | `W.pack == "waste-incineration"` で分け、それ以外はし尿処理として書く。user.md は `profile.capacity_kl_per_day` が無いと落ちる |
| `make.py` の `profile()` | 世界の正解に残す性質の軸が、決まった名前だけ。新しい軸は落ちる |
| `world.py` の契約の件名と仮の機器 | 「{n}号炉定期補修工事」「全休炉時共通設備補修工事」、炉全体・施設全体の仮の機器、活性炭と `CARBON` |
| 書き手の見出しと既定の言葉 | 日報・工程表・星取表・台帳・写真の「号炉」「全休炉」、完成図書の機器の key |
| 基幹改良 | 2 炉が前提（1 号炉 → 2 号炉の順） |
| 業者の役 | `plant`・`machine`・`om` が要る。事後の補修の役は、決まった一覧に無ければ `machine` になる |
| 日報だけの点検 | 契約を `annual:om` に決め打ち |

直し方の考え：

- 言葉は `world.json`（`naming`・`outageRows`・新しい項目）から引くようにし、コードに業種の語を残しません。
- 性質の軸と README・user.md の文も、`world.json` に移します。
- 直したら、ごみ焼却とし尿処理の 12 施設を作り直し、資料のバイト列が変わらないか（変わるなら、どこがなぜ変わったか）を確かめます。

この直しは生成器の全体に掛かります。頼まれた仕事が「業種を 1 つ足す」だけなら、選べる道を付けて、頼んだセッションに聞きます。

- 先に直す
- 制約のまま作り、README に「号炉の語が残る」と書く

推すのは、先に直す道です。

#### 手順

1. パックがあるかを見ます。パックが無いとき、または `pack.json` に `profile`・`nationalTable` が無いときは、作ってよいかを頼んだセッションに聞きます。パックはアプリの全体に掛かるからです（し尿処理の `pack.json` にも、今は `profile` がありません）。
2. `common.json`（項目のコード）を読みます。機器の `class` は、その項目のコードにします。合う項目が無い機器は `class` を空（null）にします。
3. `packs/<業種>/world.json` を、ごみ焼却・し尿処理と同じ形で書きます（references/world-json.md）。
   - 「なくてはならない項目」と「個数の下限」を守ります。
   - コードが読まない項目に頼りません。
4. 法令の点検の周期は、`sources-seed.md` などの原本で照らしたものだけを `requirement` にします。照らしていないものは `recommendation` か `app` にし、`basis` に「未確認」と書きます。
5. 炉の窓が無い業種（水処理など）は、し尿処理にならいます。
   - `outage.steps` を「機器整備」の 1 段にし、`flow.inner` を空にします。
   - 作業の `at` は `A`・`B`・`Y`・`M`・`Q`・`H` だけを使います。`F` は 1 炉の窓（10 日以上）を作ります。
   - 契約の `ct` は `own` と `annual:<key>` だけを使います。`bundle` は「号炉定期補修工事」の件名の契約を作ります。
   - 系列は「号炉」の場所に入ります（`naming.furnace` を「{n}系」などにする）。
6. 業種の形が今の部品で書けないときは、コードを足す前に、どの業種にも使える形の部品として書けるかを考えます。たとえば管路は、1 台ずつでなく区間で持つ資産です。業種の語をコードに入れる案しか無いときは、選べる道と推す道を付けて、頼んだセッションに聞きます。
7. 施設を 2 つ以上作り、`check.py` と `check-publish` を通します。README と user.md に、ほかの業種の文が出ていないかを読みます。

### 4.3 様式を足す・直す（運営者の指摘など）

1. 指摘の言葉をそのまま日誌に写し、自分の読み方を並べます。
2. どの書き手の部品かを決めます：`chart.py`・`diarybook.py`・`diary.py`・`gantt.py`・`orders.py`・`ledger.py`・`specpdf.py`・`photo.py`。様式の違いは、施設の設定の項目で選べるようにします。施設ごとに 1 回きりのコードにはしません。
3. 正解（`ans.rec`）と証拠（`ev`）は、セルを書くのと同じ場所で記録します。同じ作業の書き方を変えても、世界の結び（`W.link`）は保ちます。まとめて 1 行にした作業は、全部の作業を `how` 付きで結びます。
4. `samples/maker/doc.py` の文を直します。README には「わざと入れた揺れ」、`user.md` には担当者の言葉の文があります。
5. 印刷や見た目に関わる直しは、LibreOffice の headless で PDF にし、頁の数と絵を確かめます。Excel で確かめていなければ「未確認」と書きます。

### 4.4 資料の新しい種類を足す

1. `samples/maker/<名前>.py` に書き手を足し、`make.py` の `writers()` に登録します。
2. 書き手は `(W, doc, outdir, answers, _)` を受け、`Book`（Excel）か reportlab（PDF）で書きます。行を書くたびに `Answer.rec(kind, fields, ev, sheet=, r=)` と `W.link(...)` を呼びます。PDF は `seq`、写真は `seq` と `image` で場所を持ちます。
3. `doc.py` の README・user.md の説明（`_files` と `usermd`）に、新しい種類を足します。日報の代わりになる種類なら、`make.py` の「どの資料にも書いていない作業」の判定（日報の年度）にも足します。
4. `check.py` が、新しい形式の証拠を照らせるかを確かめます。照らせなければ `check.py` を足します。

## 5. 確かめ（終わりの条件）

- `check.py` が全施設で通ること。確かめる中身は次のとおりです。
  - Excel・CSV・PDF：正解の値が証拠の番地にある。
  - 写真：大きさ（長い辺 1,568〜2,000px、60〜160KB）と正解の行があること**だけ** を見る。値は照らさないので、写真の正解は、書いたときの値をそのまま記録しておく。
  - どのファイルにも【架空】がある。
  - 前の製品の名前と、`reserved-names.txt` の名前に当たらない。
  - 結びが、ある作業とあるファイルを指す。
- `node scripts/check-publish.mjs` の当たりが 0 であること。
- 2 回作って、SHA-256 が同じであること。
- 施設の README に「わざと入れた揺れと食い違い」があること。
- 日誌（`docs/progress/<日付>-samples.md`）に、次を書くこと。
  - 作ったもの：施設・資料・ファイルの数・揺れの一覧・作り直しの命令
  - 5 つの分け方の報告：試験とビルド／画面／Claude Code で端から端まで／Windows の実機／Excel で開いて見やすかった
  - 使用量の残り
  - 次の一手
- 動画で引く行を、人の目で見直すこと。作り手が自分で見直したことにはしません。見直していなければ「未」と書きます。

## 6. 見ていない様式の組（`samples/unseen/<組>/`）

取り込みの一般性を測る、薄く多様な組です。厚い世界とは手順が違います。

1. 読み手が凍結のタグ（`reader-freeze`）を打ったあとに作ります。**組ごとに新しい作り手** が作ります。前の組は見ません。
2. 1 組は、架空の施設 3〜4、ファイル 9〜10 です。組の中に、次の性質をそろえます。
   - 横持ちと縦持ち
   - 3 段の見出しと、途中の結合
   - 帳票（1 日 1 枚・1 件 1 枚・1 日 1 シート）と続紙
   - 1 シートに複数の表、途中で変わる見出し
   - 上にある合計、年度の途中で増える列
   - ページごとに見出しをくり返す PDF の罫線の表
   - Shift_JIS の CSV
   - 写真
3. 組の半分はごみ焼却、残りはほかの業種です。ごみ焼却では、Excel・CSV・PDF・写真の形式ごとに 1 様式以上を入れます。
4. 組の束（`files/`・`answer/`・`gen/`・`user.md`）の **SHA-256 だけ** を先にコミットします。中身は、読み手が走らせたあとに公開し、ハッシュが合うことを確かめます。
5. 合格しなかった組で、測り直しません。直したら、新しい組（新しい作り手）で測ります。締切の時点で、非公開の組を残しません。

## 7. つまずいた所（前の作り手の記録）

| 症状 | 原因と直し方 |
|---|---|
| 8 台を超える号機で落ちる | `fill` の `{A}` が A〜H までだった。10 台を超えたら数字に替える |
| 群の機器の印が、年度ごとにばらばらに出る | 群やペアの機器は、位相を共有させる（`shared_phase`） |
| 群の機器の作業が 1 台ずつ順に並び、窓が 50 日になる | 群の作業は同じ日付で並行させ、工数と費用を台数で割る |
| 全休炉が長くなりすぎる | 全休炉は 14 日を上限にし、入りきらない分は別の班で並行させる |
| cp932 の CSV で「—」が書けない | 「―」に置き換える（`safe()`） |
| 正解の項目名が `reserved-names.txt` に当たる | 項目名を言い換える（`aggregate` → `rollup`） |
| `check-publish` が `check.py` に当たる | 名前の正規表現を `check-publish.mjs` から読む |
| 2 回作ると xlsx のバイト列が違う | zip の時刻と docProps の作成日時を固定する（`book.py`） |
| 日報で「#2」と「21号機」が「#221号機」になる | 号炉の書き方が数字で終わり、号機が数字で始まるときは、空白を挟む |
| 現場計器 24 点が 1 人ずつ 24 行になる | 同じ日の群の作業は 1 行にまとめる（結びの `how: "group"`） |
| Skill の説明がコードと食い違う | Skill を書いたら、まっさらなエージェントに Skill とコードを読ませ、食い違いを挙げさせる（読み手の禁止の一覧も渡す） |

## 8. 報告

頼んだセッションへの報告と日誌は、日本語で、分けて書きます。確かめていないものは「未確認」と書きます。報告に入れるのは次のものです。

- 何を作った・直したか（施設、年度、ファイル）
- コミット
- `check.py` と `check-publish` の結果
- まだ確かめていないこと

main への merge と push は、頼んだセッションが決めます。
