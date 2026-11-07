---
id: intake-screen-v3
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 25
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 資料のセルを選ぶと、そのセルを決めた答えと「| 取り消す」を詳しくに出す

前の仕事 intake-screen-v2 の報告の「判断をお願いしたいこと」の道 1 で進める（Dev の決定、11-07）。画面の形は `docs/screens.md` §3.3 の末尾の「答えの取り消し」（Wire）：資料のシートでセルを選ぶと、詳しくに 1 行「答え　{答えの字}　{作者}　{日時 YYYY-MM-DD HH:MM}」と「| 取り消す」。取り消すと、その質問は未回答に戻り、同じ答えで決まったセルもまとめて戻る。確定のシートには人の答えを並べない。

先に読む：`AGENTS.md`、`docs/screens.md` §3.3、`src/import/compose.ts`（`CellStatus`、504・561・610 行目あたりの `qs`・`decidedBy`）、`src/app/intake/worker-protocol.ts`（`SheetWire`）、`src/app/intake/intake-host.ts`、`src/app/intake/workspace.ts`（`undoAsync`・`settle`）、`src/app/pages/Intake.tsx`（`cellInfo`）、`src/app/pages/Merge.tsx`。

1. **取り込みの側**：
   - `CellStatus` の `data`・`excluded` に、そのセルを決めた質問の id の並び `qs?: string[]` を足す（compose が明細・機器の節・除外を決めたときの `decidedBy` から。無ければ付けない）。`unresolved` の `questionId` が null ばかりなら、分かる所では埋める。
   - `CellStatus` は画面への写しだけに使い、版の記録・署名される字（readingDecisions・Decision・basis）には入れない。署名される字が変わらないことを試験で確かめる（今の版の記録の試験が通ること）。
   - 作業場に「質問 id → 答えた時刻」の表を置く（settle で書き、undo で消す）。Decision には足さない。worker の形でも同じ値が画面に届く（`SheetWire` と、作業場の写しの型）。
2. **画面**：資料のシートで `qs` のあるセルを選ぶと、横の板の詳しくに質問ごとに 1 行「答え　{答えの字}　{作者}　{日時}」と「| 取り消す」。作者の字は今の `src/app/text/index.ts` のもの（人・会話の回答・Claude 判断）。押すと `undoAsync(questionId)`。戻ったら、横の板の未回答と、下の帯の押せない理由の数が増える。
3. **試験**：vitest で、答えたセルの `qs` に質問 id が入る（同じ thread と worker の両方）・時刻が届く・取り消すと未回答が 1 増え、同じ答えで決まったセルが未解決に戻る・版の記録の字が変わらない。`tests/e2e/intake.spec.ts` に「答えて、セルを選んで取り消して、答え直すと押せる」段を足す（playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く）。

触らないもの：`src/shared/tools.ts`、`src/cli/`、署名される字、`packs/`。Claude に返す字は変えない。

済んだと言える条件：verify が通る。report.md に、変えた型、足した字、試験の数、未確認のことを書く。
