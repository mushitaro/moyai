# 2026-11-18 日誌：AI が確定した版を読むだけで読める

運営者が M-PC3 の Claude Desktop のデモで見つけた困りごと：保管先に確定した版「【架空】デモ工場 令和8年度版（第1版）」が 1 つあり、作業中の計画が無い状態で「データを見て工場の名前を正しくして」と頼むと、Claude は「資料 0 件・作業中の計画なし」と答え、確定版があることに気づかず、中身も読めなかった。
提出の版（タグ submission・枝 hackathon-release）には触れていない。画面は変えていない。

## したこと

1. **chart_rows が確定した版を読む**（`src/bridge/tools.ts`・`src/shared/tools.ts`）
   - 作業画面が「作業中の計画が無い」（no_working_plan）と答えたときだけ、橋渡しが保管先の確定・署名した最新の版の行を返す。返りに `source: "confirmed"`、`version`（第 n 版の番号）、`confirmed`（planId・施設の名前・版の番号・呼び名「令和 8 年度版（第 1 版）」）、`note`（確定版は読むだけ）を足した。
   - 作業中の計画があるときは今のまま（`source: "working"`。`version` は作業中の版で、案の basedOnVersion に使う）。
   - 引数 `planId`（省ける）で施設を選べる。省けば、いちばん新しく署名した版。知らない planId・確定した版の無い保管先は、今のとおり no_working_plan。
   - 行は作業画面と同じ関数で作る：`src/plan/ai-rows.ts`（`chartRows`・`workRows` を作業画面から移した）。確定版の行の並びは計画の順（施設の見せ方〔行の並べ替え〕は作業画面のブラウザにだけあるので効かない。説明に書いた）。
   - 行の数は、作業中の計画と同じく会話の上限（2,000 行）で数える。
2. **intake_survey の要約に確定した版の一覧**（part: all のときだけ）
   - `confirmed`：施設ごとの確定・署名した最新の版（planId・施設の名前・版の番号・署名した日の年度・呼び名・機器と作業の数。10 まで、全部の数は total）、読まなかった施設の理由（refused）、注記。行の値（機器・作業の名前）は入れない。
3. **確かめは 1 つ**（`src/bridge/human.ts`）
   - `verifiedLatest`（readHistory の署名と鎖・checkSeen のこの PC が見た版）を、連携の `latestSigned` と AI の読むだけの道（`confirmedLatest`）が使う。`latestSigned` の返す理由は前と同じ（historyVanished・connectNoSigned）。
   - 合わない版は読まず、`history_broken`（署名か鎖が合わない・版が読めない）・`history_vanished`（前に見た版か署名が消えた）を返す。誤りの一覧（`src/shared/errors.ts`）に 2 つ足した（送り手は橋渡し・受け手は AI）。
4. **AI の文**（英語。利用者には利用者の言葉で返す形）
   - tools.ts の chart_rows と intake_survey の説明、instructions.ts（1 行。3,242 → 約 3,560 字で 4,096 の内）、1 段目の Skill の流れ（`src/shared/skill-moyai.ts` → `skills/moyai/SKILL.md`）、注記 2 つ：「確定版は読むだけ。変えるには、人が MOYAI のトップの画面でその施設の行の "+ Next version" を押して作業中の計画を開く（AI からは開けない）」。
   - `docs/security.md`（ツールの説明から作る表）を作り直した。
5. **人だけの操作は足していない**：次の版を開く・確定・署名の道具は無い（試験で確かめる）。127.0.0.1 に HTTP を送っていない。状態フォルダを読んでいない（試験の一時のフォルダだけ）。

## 試験

- 足した：`tests/unit/read-confirmed.test.ts`（8 件）
  - 確定版だけ：chart_rows が確定版の行（source: confirmed・版 1・呼び名・注記・会話の数）、機器の行の id で作業の行（w:…）、planId で選ぶ・知らない planId は no_working_plan
  - intake_survey（part: all）に確定版の要約が載り、行の値は載らない。ほかの part には載らない。確定版が無ければ空の一覧
  - 版の中身を書き換えると history_broken（行を返さない・書き換えた名前を返さない）、前に見た署名を消すと history_vanished
  - 作業中の計画があるときは source: working で、確定版を読みに行かない
  - AI の文に "+ Next version" と「AI cannot open」、開く・確定・署名の道具が無い
- 直した：`tests/unit/tool-forwarding.test.ts`・`tests/unit/tool-relay-ledger.test.ts` のふりのタブの答えに `source: "working"` を足した（型が source を求めるため）。断る試験（上限を越えた行は tab_bad_result）はそのまま。
- 手元（Linux）：`npm run typecheck`・`npm run build`・`scripts/check-publish.mjs`（当たり 0）・`scripts/run-tests.mjs`（vitest 2152 通過・9 飛ばし・落ちた 0。node:test も通過）。

## 5 つの分け方の報告

- 試験とビルドが通った：手元（Linux）で上のとおり。e2e（ubuntu・windows）・pack-bench・scenario は PR の CI で見る。
- 画面で動いた：画面の変更なし。
- Claude Code で端から端まで通った：未確認（この環境では MOYAI の MCP につながっていない）。橋渡しの ToolRelay と本物の作業画面の受け手（tab-tools）を、ふりのタブでつないだ試験まで。
- Windows の実機で動いた：未確認。
- Excel で開いて見やすかった：関係なし。

## 使用量の残り

このセッションから読む道具が無いので未確認。API のキーは使っていない。

## 次の一手

- 運営者の M-PC3 で、確定版だけがある状態で「データを見て工場の名前を正しくして」を通す（intake_survey が確定版を知らせ、chart_rows で読み、"+ Next version" を押すよう頼む流れ）。
- 確定版の行に施設の見せ方（行の並べ替え）を効かせるかは未定（見せ方は作業画面のブラウザにある。要るなら作業画面が見せ方を渡す形にする）。
