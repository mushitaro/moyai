# 台帳を別のリポジトリに分ける（設計）

mushitaro/moyai#20。運営者の決定（2026-11-10）：公開の台帳を `mushitaro/moyai` の `ledger/` から、別のリポジトリ `mushitaro/moyai-ledger` に戻す。
この文書は、切り替えの設計と順を書く。2026-11-12 に MOYAI の側を切り替えた（§4 の 1。`config/ledger.json` は `mushitaro/moyai-ledger`・根は空。`ledger/` と台帳のワークフローを MOYAI から外した）。台帳の側（§4 の 2）と受け口の配置（§4 の 4）の手順は `docs/ledger-deploy.md`。

## 1. なぜ

受け口（`services/ledger-intake/`）は、GitHub のアカウントを持たない人の代わりに PR を出すので、GitHub の鍵（トークン）を預かる。
鍵はリポジトリの単位でしか絞れない。台帳が製品と同じリポジトリにあると、その鍵は製品のコードにも書ける。
台帳を別のリポジトリに置き、鍵をそこだけに絞れば、漏れても製品のコードには届かない。

## 2. 置き場所の設定は 1 か所

`config/ledger.json`：

| 欄 | 今 | 切り替えたあと |
|---|---|---|
| `repo`（台帳を持つリポジトリ） | `mushitaro/moyai`（11-12 まで） | `mushitaro/moyai-ledger`（11-12 から） |
| `root`（その中の台帳の根。リポジトリの根そのものなら空） | `ledger` | 空 |

- `src/share/ledger-place.ts` が設定を読み、道の定数（`LEDGER_ROOT`・`LEDGER_DIR`）、束と失効記録の道の正規表現、PR の道の段の上限を導く。形の違う設定は、動かす前に投げる。
- 決まり・利用条件・束は、台帳の根の下の `ledger/` に置く。今は `ledger/ledger/…`、切り替えたあとは `ledger/…`（旧台帳の形と同じ）。
- アプリ・CLI（`verify ledger`・`ledger validate-pr`・`ledger submit`・`ledger init`）・受け口・画面と CLI の文は、この定数から道とリポジトリの名前を作る。
- 受け口の配置の設定（`services/ledger-intake/wrangler.jsonc` の `LEDGER_REPO`）は、配置の道具が読む別のファイルなので、試験（`tests/unit/share/ledger-place.test.ts`）が `config/ledger.json` と同じかを確かめる。食い違えば落ちる。
- 試験は、道を定数から作る（一時の git のリポジトリのまま）。置き場所によって起きない場面（台帳の根の外を変える PR）の試験は、その置き場所でだけ走る。

### 測ったこと（2026-11-11、Linux）

設定を `{ "repo": "mushitaro/moyai-ledger", "root": "" }` に書き換えて（コミットはしない）、台帳に関わる試験（`tests/unit/share`・`ledger-intake`・`ledger-reference`・`human-routes`・`human-trial-paths`・`screen-set`・`tests/unit/cli`）を走らせた：658 件のうち 655 件が通り、2 件は走らず（台帳の根の外を変える PR の 2 件）、1 件が落ちた（`wrangler.jsonc` との食い違いを止める試験。設定だけを書き換えたので、落ちるのが正しい）。今の設定では 658 件とも通る。
e2e（`ledger-pr.spec`・`ledger-intake.spec`）と、本物の GitHub・Cloudflare では確かめていない。

## 3. 旧台帳の今（2026-11-11 に読んで確かめた）

- `mushitaro/moyai-ledger` は読める。形は台帳の根がリポジトリの根：`ledger/ledger.json`・`ledger/TERMS.md`・`ledger/bundles/<鍵ID>/…`、`.github/workflows/ledger-validate.yml`・`pages.yml`、`README.md`・`.gitattributes`。
- `ledger/` の中身（決まり・利用条件・【架空】の束 10 件）は、`mushitaro/moyai` の `ledger/ledger/` とバイト単位で同じ。
- 旧台帳の検証のワークフローは、MOYAI を別に checkout して使う形（リポジトリと commit を固定）。固定している commit は 2026-11-03 のもの（そのあとの検証の直しは入っていない）。道の絞りは無く、どの PR でも走る。
- 未確認：旧台帳の枝の守り（必須のチェック）と Pages の設定が今も有効か。書き込みの権限では確かめていない。

## 4. 切り替えの順

1. **MOYAI の側（PR 1 本。統括）**
   - `config/ledger.json` と `wrangler.jsonc` の `LEDGER_REPO` を切り替える。
   - `ledger-validate.yml` と `pages.yml` を MOYAI から外す（台帳の PR は台帳のリポジトリで検証する）。`audit.yml` の道の絞りを直す。
   - `ledger/`（【架空】のデモの束）は MOYAI から外す。試験が読む分は `tests/fixtures/` に置く。`scripts/ledger/build-bundles.mjs` の道の直書きを定数に替える。
   - 文を直す：`src/shared/security.ts`（→ `docs/security.md`）、`docs/sharing.md` §3〜4、`README.md`、`services/ledger-intake/README.md`（鍵の作り方：`moyai-ledger` だけ・Contents と Pull requests・期限つき・Workflows の権限なし）。
   - 設定の画面の「台帳の clone の場所」は、利用者が `moyai-ledger` の clone を選び直す（文は設定から出る）。前に出した束の記録（リポジトリの名前と道）は、そのまま読める形で残す。
2. **台帳の側（`mushitaro/moyai-ledger` への PR）**
   - 検証のワークフローが使う MOYAI の commit を、1 の PR を入れたあとの commit に固定し直す。`README.md` を今の約款と決まりに合わせる。
   - 必須のチェックと枝の守りを確かめる（運営者）。
3. **開いた PR #8**（MOYAI の `ledger/ledger/bundles/` に束を足す PR）：束の中身は置き場所を持たない（行き先は台帳 ID）ので、同じファイルを台帳のリポジトリの `ledger/bundles/` に出し直せる。運営者の判断（11-12）：出し直す。受け口の配置のあと、受け口に送って B3 と兼ねる（`docs/ledger-deploy.md` §4）。
4. **受け口の配置**（運営者）：Cloudflare のアカウント、鍵の発行、配置。そのあと本物で 1 本通す（mushitaro/moyai#21）。

1 と 2 のあいだは、MOYAI の `ledger/` に束を足す PR を入れない（検証のワークフローが無い時間ができるため）。

## 5. 置き場所が変わると変わる振る舞い

- PR の分け方：今は「`ledger/` の外も変える PR はコードの PR（検証しない。台帳のファイルが混ざれば ✗）」。台帳だけのリポジトリでは、どの変更も台帳の PR として照らす。束と失効記録の追加のほかは ✗（`README.md` や `.github/` の変更も ✗ になる）。旧台帳のワークフローも道の絞りを持たず、どの PR でも走る形。管理者が文書やワークフローを直す PR は検証が ✗ になるので、その扱い（必須のチェックを管理者が越える道を置くか）は、2 の PR で運営者と決める。
- `verify ledger` に渡す道：台帳の clone の根か、その下の `ledger/`。
- 守りは弱めない：台帳 ID・決まりの署名・鎖・数え直しは置き場所を見ない。道の形だけが設定から決まる。

### 切り替えたときに測ったこと（2026-11-12、Linux）

- 台帳に関わる単体の試験（`tests/unit/share`・`tests/unit/cli`・`ledger-intake`・`ledger-reference`・`human-routes`・`human-trial-paths`・`screen-set`）：680 件のうち 678 件が通り、2 件は走らない（台帳の根の外を変える PR の 2 件。台帳だけのリポジトリでは起きない）。
- 試験は MOYAI の `ledger/` を読んでいなかった（e2e も単体も、一時のフォルダにデモの台帳を作る）。だから `tests/fixtures/` に写すものは無かった。
- MOYAI の旧 `ledger/` に PR #8 の共有ファイルを足した木は `verify ledger` で ✓ 11 件。moyai-ledger の clone に足した commit も、切り替えの枝の `ledger validate-pr` で ✓（`docs/ledger-deploy.md` §5）。

## 6. 運営者に聞くこと（2026-11-12 に答えが出た）

- 台帳のリポジトリのワークフローと README を直す PR（上の 2）を、だれが入れるか。推す道：統括が PR を出し、運営者が入れる（公開の台帳の守りそのものなので）。
- PR #8 を、台帳のリポジトリに出し直すか、閉じるか。推す道：切り替えのあとに出し直す（【架空】のデモの束で、受け口の前の道の確かめになる）。
- 配置のときの判断（Cloudflare の費用・開いた PR の上限・約款への書き足し）は mushitaro/moyai#20 のとおり。
