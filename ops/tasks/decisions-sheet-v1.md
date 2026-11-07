---
id: decisions-sheet-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 15
timeoutMin: 120
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 確定のシート：会話の回答は理由なしで受ける

運営者（11-07）「この画面の UX が意味わからない」。チャットで答えたあと、確定のシートで「判断の理由」を書かないと一括確定が押せず、件数は「—」ばかりで、1 件ずつの操作が幅で隠れていた。形は Wire が決めた（`docs/screens.md` §3.2「会話の回答の受け方」、`docs/words.md`）。

先に読む：`AGENTS.md`、`docs/screens.md` §3.2、`docs/words.md`、`src/app/components/DecisionsSheet.tsx`、`src/app/text/`、`src/shared/skill-moyai.ts`（1 段目の Skill。`skills/moyai/SKILL.md` はここから作る。試験 `tests/contract/skill-moyai.test.ts` を MOYAI_WRITE_DOCS=1 で作り直す）。

1. 種類で「会話の回答」を選んでいるときは「判断の理由」の欄を出さず、上の行は「| 会話の回答 n 件を確定」だけ（押せる）。行ごとの「| 確定」も理由なしで押せる。「| 却下」は今どおりダイアログで理由を書く。
2. 「Claude 判断」「台帳案」「ルール案」は今どおり（判断の理由の欄と「| 表示中の n 件を一括確定」、押せない理由「理由：判断の理由が未入力」）。
3. 件数：取り込みの質問の答えは、その答えで決まった行の数を「n 行」（横の板の質問の「n 行」と同じ数）。表示中の種類に数のある行が 1 つも無ければ件数の列を出さない。「—」は並べない。
4. 「理由」の列は 1 行で切り、全文は title と詳しくに置く。「| 却下」「| 確定」の列は右端に固定し、幅で隠れない。
5. 説明の 1 行は置かない。代わりに 1 段目の Skill の取り込みの手順の最後に 1 行：答えが済んだら、Claude は会話で「確定のシートで会話の回答 n 件を確定してください」と伝える（確定は人が画面でする。Claude は押さない）。
6. 署名の確定の記録に入る字（作者・理由）は変えない。会話の回答を理由なしで受けたときに版の記録に何が入るかは、今の「会話の回答」の理由（Claude が置いた理由）のまま。

試験：vitest で、会話の回答のとき理由の欄が無く一括確定が押せる・行ごとの確定が理由なしで押せる・Claude 判断では今どおり押せない・件数の n 行と列を出さない形・却下と確定の列が右端。e2e で確定のシートを見ている所を新しい形に合わせ、会話の回答のシートの写しを撮る段を足す（`shot("decisions-conversation-${tag}")`。playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く）。

触らないもの：`src/import/`、`src/app/intake/`、`src/cli/`、`packs/`、署名される字。

済んだと言える条件：verify が通る。report.md に、変えた所、試験の数、未確認のことを書く。
