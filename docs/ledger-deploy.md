# 受け口の配置と、本物で 1 本通す手順（S-B3）

mushitaro/moyai#20・#21。運営者の判断（2026-11-12）：受け口（`services/ledger-intake/`）を Cloudflare に配置する。手順とコマンドは統括が用意し、**運営者が自分のアカウントで 1 回だけ**配置の操作をする。鍵（トークン）は統括に渡さない。そのあと本物で【架空】の共有ファイル 1 本を通す（`docs/scenarios.md` の B3）。

この文書には、鍵の値も、Cloudflare のアカウントの名前も書かない。書くのは手順とコマンドだけ。

## 0. 前提（配置の前にそろっていること）

| 順 | 何 | 誰 | 確かめ方 |
|---|---|---|---|
| 1 | MOYAI の側の切り替え（`config/ledger.json` が `mushitaro/moyai-ledger`・根は空）が main にある | 統括 | `git show origin/main:config/ledger.json` |
| 2 | moyai-ledger の検証のワークフローと Pages が、1 の main の commit を使う（`MOYAI_SHA` の直し。§5） | 統括が PR を出し、**運営者が入れる** | moyai-ledger の `.github/workflows/ledger-validate.yml` の `MOYAI_SHA` |
| 3 | moyai-ledger の main の守り（PR 必須・必須のチェック `ledger-validate`）が有効 | 運営者 | moyai-ledger の Settings → Rules（または Branches） |

1 と 2 のあいだに受け口を配置しない（古い MOYAI の版の検証では、今の束の形〔帯の版 `bands-2`〕を読めない）。

## 1. 費用：無料の範囲で始める

- Cloudflare の **Workers Free**（クレジットカードの登録なし）で動く。受け口が使うのは Workers と Workers KV だけ。
- 無料の上限（[Cloudflare の文書](https://developers.cloudflare.com/kv/platform/limits/)、2026-11-12 に読んだ）：Workers の要求は 1 日 100,000 件、KV の読みは 1 日 100,000 件、**KV の書き込みは 1 日 1,000 件**（0:00 UTC に戻る）。
- 受け口は、受けた要求 1 件ごとに KV に 2 つ書く（送り手の IP の数と、まわりの網の数）。だから **1 日におよそ 500 件**で KV の書き込みが尽きる。尽きると受け口は `503 intake.unavailable` で断る（数えられないときは受けない。上限を越えて通すことはない）。会期のあとの【架空】の確かめには足りる。
- 有料のプランに上げる・Logpush を付ける・独自のドメインを付けるのは、運営者の判断（`docs/autonomy.md` §6 の費用）。この手順ではしない。

## 2. GitHub のトークンを作る（運営者。値はどこにも貼らない）

GitHub に運営者のアカウントで入り、**Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。

| 欄 | 入れるもの |
|---|---|
| Token name | `moyai-ledger-intake` |
| Expiration | 期限を付ける（例：90 日。切れたら §3 の 4 で入れ直す） |
| Resource owner | `mushitaro` |
| Repository access | **Only select repositories** → `mushitaro/moyai-ledger` の 1 つだけ |
| Repository permissions | **Contents：Read and write**、**Pull requests：Read and write**（Metadata：Read-only は自動で付く） |
| ほかの権限 | 付けない（Workflows・Issues・Administration・Secrets・Account permissions のどれも No access のまま） |

- これで、トークンが漏れても届くのは moyai-ledger の枝と PR だけ。MOYAI のコード（mushitaro/moyai）には書けない。Workflows の権限が無いので `.github/workflows/` も変えられない。main は §0 の 3 の守りで、PR と必須のチェックを越えられない。
- 受け口が使う GitHub の呼び出し：リポジトリ・枝・木・blob を読む、枝を作る、ファイルを 1 つ置く、PR を出す・一覧・ファイルを読む、取り下げのとき PR に書いて閉じる。PR に書く呼び出し（issues の comments）は Pull requests の書き込みで足りる、と GitHub の文書にある（本物では未確認。足りなければ取り下げだけが 502 で止まり、束の PR は出せる）。
- 受け口は形が `github_pat_…` のトークンだけを受ける（ほかの形なら `503 intake.notConfigured`）。classic のトークンは使わない。
- トークンの値は、§3 の 4 で wrangler が聞いてきた端末にだけ貼る。チャット・Issue・ファイル・統括のセッションに貼らない。

## 3. 配置する（運営者の PC で 1 回。Node 22 と git があること）

そのまま写せる形。`#` の行は説明。

```bash
# 1. MOYAI の main を取り、依存を入れる（受け口は MOYAI の src/share/ を一緒に束ねる）
git clone https://github.com/mushitaro/moyai.git moyai-deploy
cd moyai-deploy
npm ci
cd services/ledger-intake

# 2. Cloudflare に入る（ブラウザが開く。運営者のアカウントで許す）
npx wrangler@4.152.0 login

# 3. 件数を数える KV を作る（wrangler.jsonc に kv_namespaces が足される）
npx wrangler@4.152.0 kv namespace create moyai-ledger-intake --binding INTAKE_KV --update-config

# 4. 配置する。出た URL（https://moyai-ledger-intake.<アカウントの名>.workers.dev）を控える
npx wrangler@4.152.0 deploy

# 5. トークンを入れる（端末が聞いてくるので §2 のトークンを貼る。画面には出ない）
npx wrangler@4.152.0 secret put GITHUB_TOKEN
```

- 3 で `wrangler.jsonc` に足されなかったら、出た id で `"kv_namespaces": [{ "binding": "INTAKE_KV", "id": "<出た id>" }]` を `vars` の隣に書いてから 4 へ。KV の id は秘密ではない。
- 4 と 5 のあいだ、受け口はトークンが無いので `503 intake.notConfigured` で断る（何も受けない）。5 のあとは配置し直さなくてよい。
- `wrangler.jsonc` の `vars.LEDGER_REPO` は `mushitaro/moyai-ledger`（`config/ledger.json` と同じ。食い違えば MOYAI の試験が落ちる）。直さない。
- 記録（observability）は `wrangler.jsonc` で切ってある。Cloudflare の画面で Logs・Logpush を付けない（受け口は送り手の IP を数えるのに使い、残さない約束）。
- 3 で変わった `wrangler.jsonc` は、そのままでよい（コミットしない）。KV の id を MOYAI に写すときは統括が PR にする。

### 統括に知らせるもの

mushitaro/moyai#21 に、**受け口の URL だけ**を書く（`https://moyai-ledger-intake.….workers.dev`。秘密ではない）。トークン・KV の id・Cloudflare のアカウントの画面は書かない。

### 止める・鍵を替える

- 止める：`npx wrangler@4.152.0 delete`（受け口を消す）か、GitHub でトークンを Revoke（受け口は 502 か 503 で断るようになる）。
- 鍵を替える：§2 で新しいトークンを作り、§3 の 5 だけをもう一度。古いトークンは Revoke。

## 4. 本物で【架空】の共有ファイル 1 本を通す（統括。配置のあと）

通すのは、開いた PR mushitaro/moyai#8 の共有ファイル（【架空】デモ工場。運営者が 11-08 にアプリの SHARE で署名したもの）。これを受け口に送ると、moyai-ledger への出し直し（運営者の判断 2026-11-12 の 3）と B3 が 1 本で済む。中身は施設名も費用も持たない（PR #8 の差分のとおり）。

送るのは公開の台帳への送信なので、運営者の判断（2026-11-12 の 2）の範囲の、この 1 本だけ。見張りのフックか網の決まりが止めたら、回り道をせず、同じコマンドを運営者に頼む。

```bash
# 1. MOYAI の main と moyai-ledger の main を取り、ビルドする
git clone https://github.com/mushitaro/moyai.git && (cd moyai && npm ci && npm run build)
git clone https://github.com/mushitaro/moyai-ledger.git

# 2. PR #8 の共有ファイルを取り出す（道は前の置き場所 ledger/ledger/…、ファイルの名前と中身はそのまま）
cd moyai
git fetch origin refs/pull/8/head
F=000001-6e72d5682b12f1c8.json; K=5c8bb9398d84ffe4
git show FETCH_HEAD:ledger/ledger/bundles/$K/$F > ../pr8-$F

# 3. 送る前に、moyai-ledger の main に足したときに受け手と同じ関数で ✓ かを確かめる（手元の写しで。moyai-ledger の clone は変えない）
rm -rf ../ledger-check && cp -r ../moyai-ledger ../ledger-check && mkdir -p ../ledger-check/ledger/bundles/$K && cp ../pr8-$F ../ledger-check/ledger/bundles/$K/$F
node dist/cli.js verify ledger ../ledger-check     # すべて ✓（共有ファイル 11 件）で終わりの値 0 のときだけ次へ

# 4. 受け口に送る（URL は運営者が #21 に書いたもの。末尾に /submit）
curl -sS -X POST -H 'content-type: application/json' --data-binary @../pr8-$F "<受け口の URL>/submit"
# → {"ok":true,"pr":{"number":<n>,"url":"https://github.com/mushitaro/moyai-ledger/pull/<n>"}}
```

確かめること（それぞれ結果を #21 と日誌に書く）：

1. 答えが `ok: true` で、PR が moyai-ledger にできた。枝は `intake/<ハッシュの頭 16 字>`、本文の頭は「受け口から（GitHub のアカウントなし）」、ファイルは `ledger/bundles/5c8bb9398d84ffe4/000001-6e72d5682b12f1c8.json` の 1 つだけ。
2. その PR の `ledger-validate` が ✓（GitHub の PR の Checks。結果の文が PR に書かれる）。**これで B3 は合格**。
3. 同じファイルをもう一度送ると、同じ PR の番号が返る（新しく出さない）。
4. 断る：形の違う体（`curl … --data-binary 'x'`）は `400`、PR は増えない。数の上限は本物では試さない（1 時間ふさがる。手元の試験 `npm run scenario:b2` で確かめている）。
5. Cloudflare の画面（Workers → moyai-ledger-intake → Metrics）で、要求の数だけを見る。Logs は付いていない。

そのあと：

- moyai-ledger の PR をマージするかは**運営者**（公開の台帳に載る）。
- 統括は mushitaro/moyai#8 に「moyai-ledger の PR #<n> に出し直した」と書いて閉じる（mushitaro/moyai の `ledger/` はもう無いので、#8 は入れられない）。
- アプリの `src/bridge/ledger-intake.ts` の `LEDGER_INTAKE_URL` に URL を入れ、SHARE の「MOYAI 経由」を画面で通す PR は、別に出す（#21 の 2 つ目）。

### 新しい【架空】の共有ファイルで通すとき（PR #8 を使わないとき）

デモの道具が、moyai-ledger の今の決まり（`ledger.json`）で、新しい鍵の束を作る（秘密鍵は一時の状態のフォルダにだけ書く。台帳の外に出さない）。

```bash
cd moyai
node scripts/ledger/build-bundles.mjs --out ../b3-out --ledger-json ../moyai-ledger/ledger/ledger.json --month 2026-11
ls ../b3-out/ledger/bundles/*/      # 架空の 10 施設。新しい鍵なので、どれも台帳に無い鍵 ID
# そのうち 1 つを、上の 3（verify ledger）と 4（curl）に渡す
```

## 5. moyai-ledger の守りを直す PR（統括が出し、運営者が入れる）

§0 の 2。中身は `docs/ledger-repo/moyai-ledger.patch`（moyai-ledger の main `cdbe246` に当てる差分）：

- `ledger-validate.yml` と `pages.yml` の `MOYAI_SHA` を、MOYAI の切り替えが入った main の commit にする（差分の中は `__MOYAI_SHA__`。入ったあとの SHA に置き換えて出す）。
- `README.md`：受け口の道（枝の名前・本文の頭・トークンの絞り）、MOYAI の版の直し方、11-07〜11-12 の置き場所。

当て方（moyai-ledger の clone で）：

```bash
SHA=<MOYAI の切り替えが入った main の commit（40 字）>
git checkout -b moyai-pin-after-split origin/main
git apply ../moyai/docs/ledger-repo/moyai-ledger.patch
sed -i "s/__MOYAI_SHA__/$SHA/" .github/workflows/ledger-validate.yml .github/workflows/pages.yml
```

- この PR はワークフローと README を変えるので、`ledger-validate` は ✗ になる（台帳だけのリポジトリでは、束の追加のほかは ✗。設計どおり）。moyai-ledger の README の「保証できないこと」のとおり、運営者が守りを一時的に止めてマージし、すぐ戻す。止めた時刻・戻した時刻を日誌に書く。
- 手元で確かめたこと（2026-11-12、Linux）：切り替えの枝の MOYAI（`config/ledger.json` が moyai-ledger・根は空）でビルドした `ledger validate-pr` を moyai-ledger の clone に走らせると、main の全部（base = head）は ✓ 10 件で終わりの値 0、PR #8 の共有ファイルを足した commit は `mode: pr`・✓ で終わりの値 0。本物の Actions では未確認。
- 統括のセッションに moyai-ledger への書き込みの権限が無いとき（2026-11-12 の作業役は、権限の確かめで足せなかった）は、運営者が上の当て方で枝を作って PR を出すか、統括のセッションに moyai-ledger を足す。

## 6. 手元の確かめ（配置の前でも走る。S-B2）

```bash
npm run scenario:b2
```

`tests/unit/scenario-b2-intake.test.ts`：架空の施設の共有ファイルを、アプリの送り（`sendToIntake`）から受け口のハンドラに渡し（網は使わない）、メモリの GitHub に PR を出させ、その PR を台帳のワークフローと同じ `ledger validate-pr` で一時の git のリポジトリに照らして ✓。断る試験：数の上限（429）、転送（GitHub の 3xx をたどらない・アプリは受け口の転送をたどらない）、鍵の取り違え（ほかの鍵で署名した共有ファイルは受け口が 400、PR にしても validate-pr が ✗）。
