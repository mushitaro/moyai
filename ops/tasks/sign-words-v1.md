---
id: sign-words-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 15
timeoutMin: 120
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 署名のダイアログを、頼むことで「確定する」と「渡す」に分け、署名した版を年度で呼ぶ

動画の山場（C16）で、運営者が「変」と言った（自分で確定するのに、題とボタンが「渡す」だった）。Wire が形を決めた（`docs/screens.md` §3.4 の末尾、`docs/words.md`）。

先に読む：`AGENTS.md`、`docs/screens.md` §3.4、`docs/words.md`、`src/app/components/SignDialog.tsx`、`src/app/text/human.ts`（`titleHandoff`・`submitHandoff`・`renewSubmit`）、`src/app/text/index.ts`（`signed`）、`src/app/components/MoyaiTop.tsx`（版の履歴の行）、施設の年度の始まり（`Facility.fiscalYearStartMonth`）。

1. **ダイアログの題と主ボタン**：
   - 渡さずに自分で確定する：題「第 n 版に署名して確定する」、主ボタン「署名して確定する」。下の帯の「署名して確定する…」から開いたときの既定はこれ。
   - 編集を頼む・承認を頼む：題「第 n 版に署名して渡す」、主ボタン「署名して渡す」（今のまま）。
   - 承認を頼まれた人の「承認して署名する」は今のまま。
2. **版の呼び名**：署名したとき、署名した日の年度（施設の年度の始まりで数える）を和暦で「令和 8 年度版」とする。版を一意に決めるのは「第 n 版」のまま。
   - 出すのは、結果の 1 文と、トップの版の履歴の行だけ：「令和 8 年度版（第 1 版）」。
   - 結果の 1 文：自分で確定「令和 8 年度版（第 1 版）を確定しました。」、承認「令和 8 年度版（第 1 版）を承認しました。」。差し戻しと、渡したとき（まだ確定していない）は年度なしで今のまま。
   - 編集中の版（見出し・下の帯・題）には付けない。星取表の年度の列は西暦のまま。
   - 和暦の換算は今のコードにあれば使う（`src/import/era.ts` など）。年度は版の記録の署名の時刻から出し、署名される字には足さない（見せ方だけ）。
3. **星取の数の字**：`docs/words.md` の「印 → 星取」の表のとおり、「星取　追加 a・削除 r・変更 c・変更なし s」「第 n 版から：星取の追加 a・削除 r・変更 c」。画面に「足した印」「印」が残っていれば直す。
4. 字は `src/app/text/`。`tests/contract/old-words.test.ts` を通す。

試験：vitest で、自分で確定と渡すで題と主ボタンが違う、年度の換算（4 月始まりで 2026-03-31 は令和 7 年度、2026-04-01 は令和 8 年度、1 月始まりの施設）、結果の 1 文とトップの行に「令和 n 年度版（第 m 版）」、同じ年度に 2 つで第 m 版で分かれる、編集中には付かない。e2e で字を見ている所は新しい形に合わせる（playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く）。

触らないもの：`src/import/`（era.ts は読むだけ）、`src/app/intake/`、`src/cli/`、`packs/`、署名される字（版の記録・basis）。

済んだと言える条件：verify が通る。report.md に、変えた所、試験の数、未確認のことを書く。
