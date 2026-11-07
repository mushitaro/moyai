---
id: ledger-intake-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 35
timeoutMin: 240
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# GitHub のアカウントが無くても、公開の台帳へ出せる受け口

運営者の決定（2026-11-07）：GitHub のアカウントを持たない利用者も、公開の台帳へ束を出せるようにする。MOYAI の受け口が束を受け取り、運営者（tsunagi）の GitHub のアカウントで台帳に PR を出す。今の道（利用者の GitHub で PR を出す。`src/bridge/github.ts`）は残し、もう 1 つの道として足す。

先に読む：`AGENTS.md`、`docs/plan.md` §2.8・§2.12（通信の例外）・§2.18.5、`docs/security.md`、`src/bridge/github.ts`（今の PR の出し方）、`src/bridge/human.ts`（SHARE の道）、`src/share/ledger.ts`（`verifyLedgerFiles`：台帳の検証）、`src/share/ledger-send.ts`・`bundle.ts`・`sign.ts`、台帳のリポジトリの `.github/workflows/ledger-validate.yml`（同じ検証を PR で走らせている。https://github.com/mushitaro/moyai-ledger）。

1. **受け口**（新しいフォルダ `services/ledger-intake/`。Cloudflare Workers。`wrangler.jsonc` と `src/index.ts`。デプロイはしない。運営者がする）：
   - `POST /submit`：体は束のファイル 1 つ（JSON、上限 256 KB）。
   - 受ける前に確かめる：JSON の形・深さ、束の署名、台帳の検証（`verifyLedgerFiles` と同じ関数を使う。k < 5・費用の欄・施設名など、台帳の Actions と同じ理由で断る）。断るときは 400 と理由の一覧（台帳の検証の字のまま）。
   - 濫用の防ぎ：同じ IP から 1 時間に 10 件まで（Workers の KV か Rate Limiting の束縛。どちらかを選び report.md に書く）。束の中身のハッシュが同じなら、前の PR を返して新しく出さない。
   - PR を出す：秘密の `GITHUB_TOKEN`（運営者の GitHub の fine-grained のトークン。台帳のリポジトリだけ、contents と pull requests の書き込み）で、台帳のリポジトリに枝 `intake/<ハッシュの頭 16 字>` を作り、束のファイル 1 つを置き、PR を出す。PR の本文に「受け口から（GitHub のアカウントなし）」と束の鍵 ID。台帳のリポジトリは変数 `LEDGER_REPO`（`owner/name`）。
   - 答え：`{ ok: true, pr: { number, url } }`。トークン・IP はログにも答えにも出さない。
   - 試験：vitest で、ハンドラを関数として、GitHub への fetch を差し替えて試す（形が違う・署名が違う・k < 5 で断る、同じハッシュで前の PR を返す、上限で断る、トークンを出さない）。
2. **アプリの道**：SHARE の公開の台帳に「GitHub のアカウントなしで出す」道を足す。押せるのは、今と同じく人が署名したあとだけ（AI のツールにしない）。橋渡しが受け口の URL（定数 `LEDGER_INTAKE_URL`。既定は空で、空なら道を出さない）に束を POST し、返った PR の行方は今と同じ読み方（公開の PR をトークン無しで読む）で出す。画面の字と置き場所は Wire の決め（`docs/screens.md` §3.6）に従う。まだ決まっていなければ、字は `src/app/text/` に仮に置き、report.md に「Wire の確認待ち」と書く。
3. **通信の例外**：`docs/plan.md` §2.12 と `docs/security.md` に、受け口の行き先を足す（行き先は受け口の 1 つだけ。送るのは公開の台帳に載せるのと同じ束だけ。受け口は送り手の IP を数えるのに使い、残さない）。字は運営者の決定のとおりに短く。
4. 字は `docs/words.md` に従う。

触らないもの：`src/import/`、`src/app/intake/`、`packs/`、署名される字（束の形・署名の字）。今の GitHub の道は壊さない（試験はそのまま通す）。

済んだと言える条件：verify が通る。report.md に、受け口の確かめの順、濫用の防ぎ、運営者がデプロイのときにすること（トークンの権限・`wrangler secret put GITHUB_TOKEN`・`LEDGER_REPO`・KV の作り方）、試験の数、未確認のこと（本物の Cloudflare と GitHub で通したこと）を書く。
