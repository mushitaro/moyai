# MOYAI の公開の台帳

[MOYAI](https://github.com/mushitaro/moyai) の束（施設ごとの、共通の設備項目 × 作業の属性の、周期・工数・日数の帯）を集める台帳です。似た施設の保全の周期・工数・日数を、施設名も費用も出さずに比べるためのものです。

- 会期中（Built with Claude: Japan 2026）は、**架空の施設だけ**を載せます。
- 共有する値は帯だけです。**費用は共有しません**（束に費用の欄はありません）。利用条件は [`ledger/TERMS.md`](ledger/TERMS.md)。
- 束の検証は、MOYAI と同じ関数を GitHub Actions で走らせて行い、**マージは管理者（人）**がします。

ライセンス：Apache-2.0

## 中身

```
ledger/ledger.json                                   台帳の決まり（管理者が署名。厳しくする向きだけ）
ledger/TERMS.md                                      利用条件
ledger/bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json     束（足すだけ。消さない・直さない）
.github/workflows/ledger-validate.yml                PR の束の検証（必須のチェック）
.github/workflows/pages.yml                          マージのあと、確かめ直した束から似た施設の表を作って Pages に出す
```

## 台帳の決まりと管理者の鍵

- 台帳 ID：`317f291617ec26bb`（決まり 版 1。2026-11 に管理者が署名）
- 管理者の鍵の指紋：`FPST-2SWX-XATX-08FS`

束の本文には行き先としてこの台帳 ID が入り、ほかの行き先の束は ✗ です。決まりを変えられるのは管理者の鍵だけで、変えられるのは厳しくする向きだけです。指紋は `ledger/ledger.json` の公開鍵から、MOYAI の `verify ledger` と同じ方法で求められます。

## 自分で確かめる

台帳を clone し、MOYAI と同じ関数で全部の束を確かめ直せます。

```bash
git clone https://github.com/mushitaro/moyai-ledger.git
git clone https://github.com/mushitaro/moyai.git
cd moyai && npx -y npm@11.21.1 ci --ignore-scripts && npm run build
node dist/cli.js verify ledger ../moyai-ledger
```

束ごとに ✓ か、理由つきの ✗ を出します（すべて ✓ なら終わりの値 0）。

## 束を出す（人だけ）

束は、送る側の PC の MOYAI の検問所で人が確かめ、合言葉で署名したものです。PR の支度は人だけのコマンド（端末でなければ断る）がし、PR を出すのも人です。

```bash
node dist/cli.js ledger submit --bundle <束のファイル> --repo <この台帳の clone>
```

PR を出した GitHub アカウントは誰にでも見えます。台帳専用のアカウントを勧めます。

## 検証の守り（`ledger-validate.yml`）

- `pull_request_target` で、既定のブランチにある定義だけを走らせます。PR の head のコードは走らせず、checkout もしません（オブジェクトだけを取り、`git cat-file` で中身を読みます）。
- 許すのは、`ledger/bundles/<鍵ID>/` の下に**新しく足す**ファイル（mode 100644）だけです。消す・変える・改名・symlink・submodule・`.github/` に触れるもの・大文字小文字や Unicode の正規化だけが違う道は ✗ です。
- 鍵 ID と出した人の結びつきは、束の署名で決め、GitHub のログイン名には頼りません。
- 検証のジョブの権限は `contents: read` だけで、secrets もトークンも使いません。PR に結果を書くジョブは別で、`pull-requests: write` だけです。
- MOYAI は commit の SHA で固定し、Action もフルの SHA で固定しています。

## 保証できないこと

[`ledger/TERMS.md`](ledger/TERMS.md) の終わりに書いています。中身が本当かは示せず、受け取った人は写せます。
