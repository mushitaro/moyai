---
id: intake-add-folder-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 12
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# intake_add_files の folder で、Skillパックと施設名もチャットから置く

運営者の決まり：利用者に、チャットの指示のほかの操作をさせない。今の `intake_add_files`（`src/shared/tools.ts`・`src/bridge/intake-files.ts`・`src/app/intake/tab-tools.ts` の `addFilesFromBridge`）は、`source: "demo"` のときだけ作業画面の Skillパックと施設名を置く。`source: "folder"` では置かないので、空のままだと計画を作れず、利用者が画面で選ぶことになる。

先に読む：`AGENTS.md`、上の 3 つのファイル、`tests/unit/intake-add-files.test.ts`、`skills/moyai/SKILL.md` の「チャットで入れる・デモ・消す」（元は `src/shared/skill-moyai.ts`）。

1. `source: "folder"` に、任意の `pack`（Skillパックの ID。今ある Skillパックだけ。無いものは誤り）と `facilityName`（40 字まで）を足す。作業画面で、その欄が空のときだけ置く（人が画面で選んだ・打ったものは上書きしない）。置いたことは AI の作業の欄に知らせる（今の `ws.note("ai", …)` の形）。
2. 1 段目の Skill の手順に「利用者の資料を入れる前に、どの施設か（施設名）と業種（Skillパック）をチャットで聞き、intake_add_files に添える」を足す。instructions の字の上限を越えないこと。
3. 作業場をまっさらにする道：デモの資料と作業中の資料が混ざるとき（`intake_demo_mixed`）、今は「作業画面を読み込み直す」しかない。画面の取り込みのシートに、人が押す「作業場を空にする」を足すかは、この仕事ではしない。代わりに誤りの文に、利用者に画面で何をしてもらうかを短く書く（今の文を確かめ、足りなければ直す）。
4. 試験：契約（送り手と受け手）、folder で pack・facilityName が空のときだけ置く、人の値を上書きしない、無い Skillパックは誤り、施設名の長さ。
5. 言葉は `docs/words.md` に従う（Skillパック・星取・共有ファイル・共有フォルダ・確定のシート。印・束・輪・パック・決定のシートは使わない）。`tests/contract/old-words.test.ts` を通す。

触らないもの：`src/import/`、`src/app/intake/workspace.ts` の中身（公開の関数を呼ぶだけ。worker の形なので、要約は `surveyWith()` を await する）、`chart_propose`、署名される字、`packs/night-soil/`。

済んだと言える条件：verify が通る。report.md に、引数の例、Skill の文の差分、試験の数、未確認のことを書く。
