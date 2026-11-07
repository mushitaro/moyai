---
id: window-arrange-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# ヘッダの「Claude と並べる」：Claude Desktop の窓を左、MOYAI の窓を右に並べる（Windows）

運営者の頼み（11-07）：作業画面を外のブラウザで開いたとき、Claude Desktop と MOYAI の窓の大きさを 1 つのボタンで合わせたい。画面の形は Wire が決めた（`docs/screens.md` §1 のヘッダの「Claude と並べる」の 4 行、`docs/words.md` の 2 行）。

先に読む：`AGENTS.md`、`docs/screens.md` §1、`docs/security.md`（橋渡しの道と鍵）、`src/shared/routes.ts`（道の表。道を足すならここ）、`src/bridge/server.ts`・`src/bridge/tab.ts`、`src/app/components/Shell.tsx`（ヘッダ。「暗 / 明」の切り替えの並び）、`src/app/text/index.ts`。

1. **橋渡しの道**：作業画面のタブから呼ぶ道を 1 つ足す（例 `POST /tab/window-arrange`。今のタブの道と同じ鍵・同じ守り。127.0.0.1 だけ）。体は無し。答えは `{ ok: true }` か `{ ok: false, reason: "no_claude_window" | "not_windows" | "failed" }`。
2. **窓を動かす（Windows）**：橋渡しが PowerShell（`-NoProfile -NonInteractive`、`windowsHide`）で user32 を呼ぶ小さな台本を走らせる。台本は文字列の定数としてコードに置き、引数に利用者の値を混ぜない。
   - MOYAI の窓：ボタンを押した直後の前面の窓（`GetForegroundWindow`）。
   - Claude Desktop の窓：プロセスの名前が `claude` で、実行ファイルの道が `\WindowsApps\Claude_` か `\AnthropicClaude\` を含み、`MainWindowHandle` が 0 でないもの。見つからなければ `no_claude_window`（窓は動かさない）。
   - MOYAI の窓がある画面の作業領域（`MonitorFromWindow` と `GetMonitorInfo` の rcWork）で、Claude を左 40%（最小 560px）、MOYAI を右の残りに。最大化・最小化なら先に元に戻す（`ShowWindow` SW_RESTORE）。`SetWindowPos`。
   - Windows 以外は `not_windows`。
   - 台本の組み立てと、答えの読み取りは関数に分け、単体で試す（PowerShell を走らせずに）。
3. **ボタン**（`Shell.tsx` のヘッダの右、並びは「Claude と並べる・暗 / 明・設定」。字と大きさは「暗 / 明」と同じ）：
   - 出すのは、外のブラウザで、Windows で、橋渡しに接続中のときだけ。中のブラウザ（Claude Desktop の組み込み。User-Agent に `Electron` か `Claude` を含むなどで見分ける。見分け方は report.md に書き、確かめていなければ未確認と書く）・Windows 以外・未接続では出さない（押せない理由の字は置かない）。
   - 押して `no_claude_window` なら、ボタンの右に text-3 で「Claude の窓なし」を 4 秒。並べたときは字を出さない。もう一度押せば並べ直す。
4. 字は `src/app/text/index.ts` に。言葉は `docs/words.md` に従う。
5. **試験**：vitest で、台本の組み立て（40%・最小 560px の計算を、作業領域の幅 1920・1280・1000 で）、答えの読み取り、道の守り（鍵が無ければ断る）、ボタンを出す条件（中のブラウザ・Windows 以外・未接続で出ない）、「Claude の窓なし」が 4 秒出る。

触らないもの：`src/import/`、`src/app/intake/`、`src/cli/`、`packs/`、署名される字。MCP のツールは足さない（ボタンは人が押す）。

済んだと言える条件：verify が通る。report.md に、道と守り、台本、ボタンの条件、試験の数、未確認のこと（実機の Windows で窓が動くこと、中のブラウザの見分け）を書く。
