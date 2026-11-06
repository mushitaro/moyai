---
id: chat-install-v0
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 35
timeoutMin: 240
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# チャットだけで入れる・デモする・消す

運営者の決定（11-06）：初めての人は、チャット（Claude Code、Claude Desktop の Code）に GitHub のリポジトリの URL を渡すだけで、インストールが終わる。デモとアンインストールもチャットだけでする。利用者に、チャットの指示のほかの操作（端末を開く・コマンドを打つ・ダウンロード・ファイルのドラッグ・設定の画面）をさせない。人だけの操作は、確定・署名・送る・承認・昇格だけ。それ以外（setup・送信者の名前・橋渡しを起こす・資料を作業画面に入れる・uninstall）は、チャットの頼みで Claude がしてよい。署名の鍵は最初の確定で自動に作られ、合言葉は無い。要るのは送信者の名前だけ。

先に読む：`AGENTS.md`、`src/cli/main.ts`・`src/cli/setup.ts`・`src/cli/relay.ts`・`src/cli/args.ts`、`src/bridge/places.ts`（状態フォルダの settings.json。送信者の名前は `name`）、`src/bridge/state.ts`（鍵ファイル）、`src/shared/tools.ts`（ツールの定義。名前・型・時間の上限）、`src/shared/instructions.ts`（MCP の instructions）、`src/shared/skill-moyai.ts` があればそれ（1 段目の Skill の元の文）、`packs/waste-incineration/`。

1. **setup をチャットから走らせる**：`moyai setup` は今、端末で「はい」と打たせる。`--yes` を足し、確かめの文（何をどこに足すか・.bak を残すこと）を標準出力に出してから書く形にする。Claude が利用者にチャットで確かめたあとに `--yes` で走らせる前提。Claude Code には `--target code`（リポジトリの `.mcp.json` か `claude mcp add` に渡す 1 行を出す）、Claude Desktop には `--target desktop`（今の形）。`--name <送信者>` で settings.json の `name` も入れる（40 字まで。空は断る）。
2. **中継が橋渡しを起こす**：`moyai mcp`（relay.ts）は、鍵ファイルが無いか接続を拒まれたら、`moyai start --no-open` を切り離した子プロセスで起こし、鍵ファイルができるまで待って（上限 20 秒）から送る。起こせなければ今の `bridge_not_running` を返す。最初の答えに、作業画面の URL を `workScreenUrl` として載せる（instructions の「橋渡しが起きていなければ、利用者に端末で moyai start を…」の文を、この形に合わせて直す）。同時に 2 つ起こさない（鍵ファイルのそばに起動中の印を置く）。
3. **デモの資料を作業画面に入れるツール**：新しい MCP のツール `intake_add_files` を足す（`tools.ts` の決まりに合わせ、送り手と受け手の契約の試験も足す）。引数は `source: "demo"`（Skillパックの `demo/` の資料）か `source: "folder"` と `path`（利用者がチャットで言ったフォルダ。その直下の .xlsx/.xls/.csv/.pdf/.jpg/.png だけ、200 個まで、1 つ 64 MB まで）。橋渡しが資料を読み、作業画面のタブに渡し、タブが今の「落とされた資料」と同じ道で取り込む。結果に返すのは、入れた資料の名前・大きさ・件数・断った理由だけ。資料の中身（セルの値・文字）は AI の結果に入れない（安全の決まり 3）。パスは状態フォルダ・リポジトリの外の、利用者が言ったフォルダだけ（`..` やシンボリックリンクで外に出ない）。
4. **Skillパックの demo/**：`packs/waste-incineration/demo/` を作り、`samples/out/waste-incineration/fictional-1/` から 3 つの資料（どれも【架空】）を写し、`demo/README.md` に、チャットでのデモの進め方（「デモして」→ intake_add_files(source: demo) → intake_survey → 質問を利用者に聞く → intake_compose → chart_rows → 確定は人が画面で）を書く。Skillパックの SKILL.md に「デモ」の節を足し、この README を指す。check-publish の決まり（禁じた語）を通すこと。
5. **アンインストール**：`moyai uninstall [--yes] [--keep-root|--remove-root]` を作る。橋渡しを止める（鍵ファイルの居場所に止める合図。無ければ飛ばす）、Claude Desktop の設定から `mcpServers.moyai` を外す（.bak を残す）、Claude Code の登録を外す手順を出す（`claude mcp remove moyai`）、状態フォルダを消す。保存先（計画の版）は既定で残し、`--remove-root` のときだけ消す（Claude が利用者にチャットで聞いてから付ける前提）。確かめの文を先に出す。リポジトリのフォルダを消す手順（Claude が消す）は Skill の文に書く。
6. **Claude に見せる文**：1 段目の Skill の元の文と instructions に「インストール（URL を渡されたら：Node 22 以上を確かめる → 無ければ利用者にチャットで聞いてから winget で入れる → clone → npm ci → npm run build → setup --yes --name → 作業画面を開く）」「デモ」「アンインストール」の手順を短く足す。字の上限（instructions の試験が見る長さ）を越えないこと。言葉は `docs/words.md` に従う（○・● は「星取」。印・束・輪・パック・決定のシートは使わない。Skillパック・共有ファイル・共有フォルダ・確定のシート）。
7. **試験**（vitest と node:test）：setup --yes と --name、uninstall の登録・状態の消し方と保存先の既定、中継が橋渡しを起こしてつなぐ（試験では起こすコマンドを差し替えられるように）、二重に起こさない、intake_add_files の契約・パスの外れ・上限・中身を返さないこと、demo/ の資料がある。

触らないもの：`src/import/`（別の仕事が読み手を直している）、`src/app/intake/workspace.ts`（別の仕事が Web Worker へ移している。タブの側の受け口は `tab-tools.ts` に小さく足し、workspace の公開の関数を呼ぶだけにする）、`chart_propose`（別の仕事が広げている）、署名される字（basis の文・LEDGER_SOURCE・CONVERSATION_SOURCE・cond・toItem/toAttr）、`packs/night-soil/`。

済んだと言える条件：verify が通る。report.md に、チャットの手順の文（README に書く案も）、ツールの形（引数の例）、試験の数、人に頼むこと、未確認のこと（Windows の実機、winget、Claude Desktop）を書く。
