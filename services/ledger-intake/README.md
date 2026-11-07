# 公開の台帳の受け口（ledger-intake）

GitHub のアカウントを持たない人の束を受け、運営者の GitHub のアカウントで公開の台帳に PR を出す（運営者の決定 2026-11-07）。Cloudflare Workers で動く。デプロイは運営者がする。今の道（利用者の GitHub で PR を出す）は残る。

台帳は mushitaro/moyai の `ledger/`（2026-11-07 に mushitaro/moyai-ledger から移した）。束の道は `ledger/ledger/bundles/<鍵ID>/<連番>-<ハッシュ先頭16>.json`。

## 道

- `POST /submit`：体は束のファイル 1 つか、取り下げの印 1 つ（JSON、256 KB まで）。束を受けると `{ "ok": true, "pr": { "number": n, "url": "https://github.com/…/pull/n" } }`。
- 取り下げの印（`moyai.retired/0`。`{ ledger, key, pub, last, month }` をその鍵自身で署名したもの。Architect の 72）を受けると `{ "ok": true, "pr": { … } か null, "closed": [{ "number": n, "url": "…" }] }`。
- 断るときは `{ "ok": false, "reasons": [...], "reasonsText": [...] }`。理由のコードと言葉は台帳の検証（Actions の `ledger-validate`）と同じ。受け口だけの理由は `intake.*`。
- 400 形・署名・台帳の検証で ✗。413 大きすぎる。415 JSON でない。429 送信が多すぎる。502 GitHub に届かない。503 設定が未完了か、台帳の決まりが ✓ でない。

## 確かめの順

1. 道と方法（`POST /submit` だけ）・設定（`GITHUB_TOKEN`・`LEDGER_REPO`・KV）。
2. 同じ IP から 1 時間に 10 件まで。断った件も数える。
3. Content-Type（`application/json`）と大きさ（256 KB まで）。
4. JSON の形と深さ（UTF-8・入れ子 8 段まで・キーの重複なし・正規形・束の形）と、束の署名。ここまでは GitHub を呼ばない。
5. 同じ中身のハッシュの PR（枝 `intake/<ハッシュの頭 16 字>`）があれば、それを返す。新しく出さない。
6. 台帳の検証：既定のブランチから `ledger/ledger/ledger.json` と同じ鍵の束を読み、束を足した木を `verifyLedgerFiles`（台帳の Actions と同じ関数）で確かめる。k < 5・費用の欄・施設名・鎖の抜けは、Actions と同じ理由で断る。
7. 枝を作り、束のファイル 1 つを置き、PR を出す。本文の頭は「受け口から（GitHub のアカウントなし）」、続けて束の鍵 ID。

取り下げの印（`ledger/ledger/bundles/<鍵ID>/retired.json`）は、束と同じ口・同じ IP の上限で受ける。

1. 4 と 5 は束と同じ（印の署名は body の `pub` で確かめる）。
2. 台帳の検証：印を足した木を `verifyLedgerFiles` で確かめる。その鍵自身の署名で、道の鍵 ID・本文の `key`・`pub` から作った鍵 ID の 3 つがそろうときだけ受ける。印の最後の連番が、台帳に載ったその鍵の束の連番より小さければ断る。
3. その鍵の束の開いた PR（題か枝の名前に鍵 ID があり、ファイルがすべてその鍵のフォルダの束のもの）に「本人が取り下げました」と書いて閉じる。
4. その鍵の束が台帳に載っていれば（マージ済み）、印のファイル 1 つを置く PR を出す。載っていなければ、印の PR は出さない（`pr` は `null`）。

受け口の PR はどれも運営者のアカウントで出るので、「GitHub のアカウントが替わった印」（`docs/plan.md` §2.19 の 3。未実装）を受け口の PR には付けない。

## 濫用の防ぎ

- 件数は Workers の KV で数える。Rate Limiting の束縛は数える幅が 10 秒か 60 秒だけで、1 時間を数えられない。
- IP は残さない。鍵つきのハッシュ（HMAC-SHA256。鍵は `GITHUB_TOKEN` から作る）にして KV の名前に使い、値は受けた時刻の並びだけ。項目は最後に受けてから 1 時間で消える。IPv6 は /64 を 1 つの送り手として数える。
- KV は結果整合なので、別の拠点から同時に来ると 10 件を少し越えることがある。
- トークンと IP は、ログにも答えにも出さない。受け口は console に何も書かない。記録（observability）は切ってある。

## デプロイ（運営者）

前提：Node 22。リポジトリの根で `npm ci` を済ませる（受け口はリポジトリの `src/share/` を一緒に束ねる）。wrangler は版を固定して `npx` で呼ぶ。

1. GitHub で fine-grained のトークンを作る。Repository access は台帳のあるリポジトリ（`mushitaro/moyai`）だけ。Repository permissions は Contents と Pull requests を Read and write（Metadata の Read は自動で付く）。ほかは付けない。期限を付ける。台帳を moyai に移したので、このトークンは MOYAI のコードの枝にも書ける。main は ruleset（PR 必須・必須のチェック）で守る。
2. `cd services/ledger-intake`
3. `npx wrangler@4.152.0 login`
4. KV を作る：`npx wrangler@4.152.0 kv namespace create moyai-ledger-intake --binding INTAKE_KV --update-config`。`wrangler.jsonc` に `kv_namespaces` が足される。足されなければ、出た id で `"kv_namespaces": [{ "binding": "INTAKE_KV", "id": "<出た id>" }]` を書く。
5. トークンを入れる：`npx wrangler@4.152.0 secret put GITHUB_TOKEN`。端末に貼る。ファイルに書かない。
6. 台帳のリポジトリが違うときは、`wrangler.jsonc` の `vars.LEDGER_REPO`（`owner/name`。既定は `mushitaro/moyai`）を直す。
7. `npx wrangler@4.152.0 deploy`。出た URL（`https://moyai-ledger-intake.<アカウント>.workers.dev`）を、アプリの `src/bridge/ledger-intake.ts` の `LEDGER_INTAKE_URL` に入れる（末尾の `/submit` は付けない）。空の間、アプリの SHARE は送信経路に「MOYAI 経由」を出さない。
8. Logpush は付けない。

## パックの部品

受け口は `packs/` の公開語彙と全国の表を、文字列のまま `src/packs.gen.ts` に持つ（ハッシュは文字列のバイト列で決まり、台帳の決まりと照らす）。`packs/` を変えたら `node services/ledger-intake/scripts/gen-packs.mjs` で作り直す。同じかどうかは試験（`tests/unit/ledger-intake.test.ts`）が確かめる。
