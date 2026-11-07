---
id: chat-ops-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 30
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# チャットの頼みで画面を動かすツール screen_set と、表示の 3 つ（階層の入れ替え・並び順・計画の最大年度）

運営者の決定（11-07 16:40）：利用者の想定のプロンプトで、アプリがチャットだけで動くこと。人だけの操作は、確定・署名・送る・承認・昇格だけ（docs/plan.md、運営者の決定 11-06）。今は次のプロンプトが、Claude に道具が無くて動かない：
「ライトモードにして」「ファイルの保管場所を変更して」「星取表画面に切り替えて」「機器階層を入れ替えて表示して」「○○機器と○○機器の並び順を入れ替えて」「計画の最大年度は2040年までにして」。

先に読む：`AGENTS.md`、`docs/plan.md` §2.13（ツール）、`docs/screens.md`（§1 ヘッダの 暗 / 明、§3.2 HOSHITORI のシート、§3.7 設定）、`src/shared/tools.ts`・`src/shared/tool-names.json`・`src/shared/instructions.ts`（4,096 字の上限。今ほぼ満ち。足すのはツール名 1 語だけにし、使い方はツールの説明に書く）、`src/bridge/tools.ts`（`BRIDGE_TOOL_RECEIVERS`）、`src/app/intake/tab-tools.ts`（作業画面の受け手）、`src/app/components/Shell.tsx`、`src/app/pages/StarTable.tsx`・`src/plan/chart.ts`（星取表の行と階層）、`src/app/pages/Settings.tsx`、`tests/scripts/reserved-names.test.mjs`（ツールは 16 以下 → 17 以下に直す。運営者の決定 11-07 として注記）。

1. **新しいツール `screen_set`**（受け手は作業画面。kind は propose。人だけの操作はしない）。入力は次のどれか 1 つ以上：
   - `theme`: `"light" | "dark"`（ヘッダの 暗 / 明 と同じ）
   - `go`: 開く画面とシート（`"top" | "hoshitori.chart" | "hoshitori.cost" | "hoshitori.match" | "hoshitori.rules" | "hoshitori.review" | "hoshitori.decisions" | "hoshitori.files" | "export" | "share" | "settings"`）
   - `storageRoot`: 保管先の絶対の道（設定の保管先と同じ確かめ。今の確かめの関数を使う。変えたら画面を読み直す）
   - `levelOrder`: `"asset-first" | "series-first"`（星取表の階層の並び。既定は 設備 › 機器 › 号炉・系統 › 部位。series-first は 設備 › 号炉・系統 › 機器 › 部位。施設ごとに覚える。見せ方だけで、版の記録と署名される字は変えない）
   - `rowOrder`: `{ node: string, before: string }`（同じ親の下の機器の並びを変える。node と before は chart_rows の節の id。施設ごとに覚える見せ方。Excel の出力も同じ並び）
   - `lastFiscalYear`: 数（星取表の年度の列の最後の年度。例 2040。施設ごとに覚える。周期の案を置くとき、この年度まで出す。今の計画の星取は変えない）
   - 答えは、変えた項目と、今の値。変えられなかった項目は理由（例：保管先が無い道）。
2. 画面の側：上の 6 つを作業画面の今の状態に当てる（今の画面の操作と同じ関数を通す。新しい見せ方の 3 つは、画面にも人が切り替える所を置く。置き場と字は `docs/screens.md` に無ければ、設定の画面の「表示」の節に仮に置き、report.md に「Wire の確認待ち」と書く）。
3. Claude に渡す字：ツールの説明に、どのプロンプトでどの引数を使うかを短く。人だけの操作（確定・署名・送る・承認・昇格）は、このツールではしない。
4. 試験：vitest で、6 つの引数それぞれが画面の状態を変える、階層の入れ替えで星取表の行が 設備 › 号炉 › 機器 になる、並び順の入れ替えが星取表と Excel に出る、最大年度で列が 2040 まで出る、版の記録の字が変わらない、ツールの数が 17。

触らないもの：`src/import/`、署名される字、`packs/`。

済んだと言える条件：verify が通る。report.md に、変えた所、試験の数、未確認のことを書く。
