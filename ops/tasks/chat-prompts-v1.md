---
id: chat-prompts-v1
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# チャットの想定のプロンプトの小さな穴（デモの混ざり・開いた印・入っているかの確かめ）

運営者の想定のプロンプト 17 の試験（`docs/progress/prompt-test-2026-11-07.md`）で見つかった穴のうち、橋渡し・ツール・Skill の文で直るもの。取り込みの芯（`src/import/`）は触らない（別の仕事が直している）。

1. **デモの混ざり**（「デモして」）：`intake_add_files`（source: demo）を、利用者の資料（架空でない資料）が入っている作業画面に入れない。入っていれば、入れずに `refused`（理由：利用者の資料と架空の資料を混ぜない。新しい計画で始めるか、資料を外してから）を返す。架空の資料どうしは今どおり。Skill（1 段目）の「架空でない資料とは混ぜない」の決まりを、ツールで守る。
2. **開いた印**（「立ち上げて」「画面を出して」）：`intake_survey` の `show: true` の答えに、`screen: { opened: boolean, connected: boolean }` を足す（橋渡しがブラウザを開いたか・タブがつながったか）。つながっていないときは、Claude が利用者に言う 1 文（「作業画面がまだつながっていません。開いたタブを見てください」）を `note` に入れる。
3. **入っているかの確かめ**（「MOYAIをインストールして」）：1 段目の Skill（`src/shared/skill-moyai.ts` → `skills/moyai/SKILL.md` は `MOYAI_WRITE_DOCS=1` で作り直す）の「入れる」の手順の頭に、「もう入っているか：moyai のツールが呼べれば、`intake_survey`（part: skills）の版を見て、新しい版なら入れ直さない」を足す。
4. **小さなもの**：`screen_set` の答えに、今の施設の名前と計画の版（あれば）を足す。`reading_rules_propose` のツールの説明に、ルールの形（kind ごとの欄）の見本を 1 つずつ書く（`src/shared/tools.ts`。instructions は 4,096 字の上限を守る）。

試験：vitest（ツールの答えの形・デモの断り・Skill の文）と、関わる e2e（`tests/e2e/mcp.spec.ts` ほか）。言葉は `docs/words.md` に従う。
触らないもの：`src/import/`、署名される字、`packs/`、`src/app/` の画面の見た目。
済んだと言える条件：verify が通る。report.md に、直した穴ごとの前と後、試験の数、未確認のこと。
