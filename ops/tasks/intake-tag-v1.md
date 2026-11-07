---
id: intake-tag-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 号機（No.1・No.2）の区別を、星取表の階層と Claude が読む行に出す

見ていないサンプルの測り（2026-11-07 朝）で、号機の区別が見えないことが分かった。データは正しく分かれている（号機は機器の tag に入り、系列は 1）が、見え方で区別が消える。

- 「（空）｜ボイラ 給水ポンプ｜1号炉 No.1｜ポンプ本体 軸受・軸封」と、次の行の「1号炉 No.2」。星取表の階層に No. が出ず、「ボイラ 給水ポンプ › 1 号炉」が 2 つ並ぶ（chart_rows でも同じ名前の 2 行）。
- 「1号炉 No.1 減温塔噴霧P」も同じで、No.1 と No.2 の区別が見えない。号炉の無い機器でも同じ（計量機 ×2、送風機 ×6、空気圧縮機 ×3 など、同じ名前の行が並ぶ）。
- 工事共通費の行で、号炉が機器群と系列の 2 回出る（「工事共通費 › 1号炉 › 1 号炉 › 共通仮設・入出域管理」）。号炉が機器群の名前と同じときは、2 回出さない。

直す形：
1. 同じ親の下に同じ名前の機器が並び、tag（号機）で分かれるときは、星取表の階層の名前と chart_rows の行の名前に号機を添える（「ボイラ 給水ポンプ No.1」）。tag が無く名前だけが同じときは、今どおり（推測で番号を振らない）。
2. 号炉・系統の階層は今どおり、機器と部位のあいだ（設備 › 機器 › 号炉・系統 › 部位）。号機を号炉の欄に入れない。
3. Excel の出力と差分レポートの機器の名前も、同じ形にそろえる。
4. 署名される字（版の記録の機器の名前・nodeKey・detailKey・basis）は変えない。見せ方だけを変える。前の版の記録を読み直しても同じ版の記録になることを試験で縛る。

先に読む：`AGENTS.md`、`skills/moyai/SKILL.md` の「データの名前」の階層・系列・号炉の行、`src/import/records.ts`・`src/import/text.ts`（名前の中の機器番号）、`src/plan/`（星取表の行・階層）、`src/shared/tools.ts` の chart_rows、Excel の出力（`src/export/` か、それに当たる所）。

試験：vitest で、同じ親の下の No.1・No.2 の 2 機器が星取表と chart_rows で別の名前になる・号炉が機器群と同じ名前のとき 2 回出ない・tag が無ければ名前を変えない・署名される字が変わらない。

触らないもの：`src/import/session.ts`・`questions.ts`・`csv.ts`・`structure.ts`（別の仕事 intake-many-v1 が触る）、`packs/`、`src/cli/`、署名される字。

済んだと言える条件：verify が通る。report.md に、変えた所、試験の数、未確認のこと（画面と Excel で見た形）を書く。
