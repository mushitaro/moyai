---
id: lineage-screens-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 30
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 古い版の署名と適用 Skill、古い版のルールのシート、ルールの詳細の適用先

運営者の頼み（11-07 23:20）。形は Wire が決めた（`docs/screens.md` §3.2 の横の板の「署名」の節と、ルールのシートの節の末尾、`docs/words.md`）。その 3 つをそのとおりに作る。

先に読む：`AGENTS.md`、`docs/screens.md` §3.2、`docs/words.md`、`src/app/components/SignaturesPanel.tsx`、`src/app/components/ReadingsSheet.tsx`（ルールのシート）、`src/app/pages/Merge.tsx`（横の板・開いている版）、`src/plan/store.ts`（`VersionRecord.readingSkills`）、`src/bridge/readings.ts`・`src/bridge/human.ts`（保管先と共有フォルダの版の記録を読む道）。

1. **古い版の署名**：横の板の「署名 n」は、いま開いている版の署名（最新の版のものは出さない）。版の名前「令和 8 年度版（第 5 版）」、署名ごとに 1 行、その下に「適用 Skill」（`VersionRecord.readingSkills` から：基本操作・Skillパック・ルールは 1 つ 1 行）。ルールの行を押すと、ルールのシートでそのルールを選んで開く。記録が無い版は「適用 Skill の記録なし」。
2. **古い版のルールのシート**：その版で当てていたルールを今と同じ表で、見るだけ。状態の字「第 n 版で適用」。「下書き n ／ すべて n」は出さない。記録が無い版は「適用ルールの記録なし」。
3. **ルールの詳細の適用先**：ルールの見出しの行を選ぶと、詳細に名前と版（「v n」）、範囲、置き場（保管先・共有フォルダの名前。置いた所だけ）、「適用先 n」と版の行（新しい順、開ける版だけ「| 開く」）、ルールの版ごとの行（「v1　2026-05　セル 38」）。出すのは MOYAI が読める版（保管先と、共有フォルダで受け取った共有ファイルの版の記録）だけ。読めない施設は数えない。
4. 署名される字と版の記録の形は変えない（読むだけ）。
5. 試験：vitest で、古い版を開くとその版の署名と適用 Skill が出る・記録の無い版の字・古い版のルールのシートが見るだけ・適用先が 2 以上の版を新しい順に並べる・読めない施設を数えない。e2e で写しを 2 枚撮る段を足す（`shot("lineage-signatures-${tag}")`・`shot("lineage-rule-detail-${tag}")`。playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く）。

触らないもの：`src/import/`（別の仕事 reader-contracts-v1 が触る）、`src/cli/`、`packs/`、署名される字。

済んだと言える条件：verify が通る。report.md に、変えた部品、試験の数、未確認のことを書く。
