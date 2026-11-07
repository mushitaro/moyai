---
id: share-preview-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# share_preview を作る（「社内で共有して」）

運営者の想定のプロンプト「社内で共有して」で、`share_preview` が「未実装」を返す（`docs/progress/prompt-test-2026-11-07.md` の 7）。共有ファイルに何がいくつ写るかを Claude が読めないので、利用者に説明できない。

作るもの：
- `share_preview`（`src/shared/tools.ts` の形・`src/bridge/tools.ts`・作業画面の側）：SHARE の画面が共有ファイルに書く中身の、形と数だけを返す。宛先の種類（共有フォルダ・公開の台帳）、版（年度・第 n 版・ハッシュの頭）、写る機器・作業・作業の年度の値・費用の行の数、伏せる欄（共有で絞る欄。当施設の中は全部見せ、絞るのは共有だけ）、相手から見たあなた（施設の札）。行の値は返さない（安全の決まり 3）。
- 署名・送る・出すのは人だけ（決まり 1）。ツールは読むだけで、画面を SHARE に切り替える（`screen_set` の go: share と同じ）ことはしてよい。
- 確定した版が無ければ `needs`（「確定した版がありません。HOSHITORI の確定のシートで確定してから」）。
- instructions の「今動くのは」に share_preview を足す（4,096 字の上限を守る）。`not_implemented` の一覧から外す。契約の試験を直す。

試験：vitest（形・数・行の値が無いこと・確定した版の無いとき）と e2e 1 本（確定した版で share_preview の数が SHARE の画面の数と同じ）。
触らないもの：`src/import/`、署名される字、`packs/`、共有ファイルに書く中身そのもの。
済んだと言える条件：verify が通る。report.md に、返す形、試験の数、未確認のこと。
