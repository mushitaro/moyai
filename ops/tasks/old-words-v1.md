---
id: old-words-v1
role: factory
agent: factory
environment: env-kinds
budgetUsd: 12
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 人に見える字に残った古い言葉を消す（橋渡し・CLI・共有・台帳の検証）

運営者の指示（11-06）：「古い言葉をいつまでも使わないでほしい」「印は星取と言ってください」。画面の字と Claude に見せる文は直し終わり、`tests/contract/old-words.test.ts` が縛っている。残りは、橋渡し・CLI・共有の芯・台帳の検証が出す字（端末・GitHub の PR の検証・作業画面に橋渡しが返す理由の文）。

先に読む：`AGENTS.md`、`docs/words.md`（置き換えの表。とくに「### 印 → 星取（11-06 夜…）」と、束 → 共有ファイル、輪 → 共有フォルダ、仲間 → メンバー、呼び名 → 送信者、当てはめ → 紐付け、読み方 → ルール、検査 → 照査、決定のシート → 確定のシート、パック → Skillパック）、`tests/contract/old-words.test.ts`。

1. `src/cli/`・`src/share/`・`src/bridge/`・`scripts/ledger/`・`scripts/demo-ring/` の、人に見える文字列（端末への出力・誤りの文・検証の報告・橋渡しが作業画面や AI に返す文）にある古い言葉を、`docs/words.md` の言葉に置き換える。コメントは直さなくてよい。
   - 例：「✗ 束 bundles/…」→「✗ 共有ファイル bundles/…」、「仲間 4d70…」→「メンバー 4d70…」、「デモの輪」→「デモの共有フォルダ」、「この束は台帳の検証で ✗ になります」→「この共有ファイルは…」。
   - 道・ファイル名・鍵の名前・JSON のキー・型の名前・id（`bundles/`・`members/`・`ring` など）は変えない。
   - 署名される字（basis の文・LEDGER_SOURCE・CONVERSATION_SOURCE・cond・toItem/toAttr）と、共有ファイルの body に入る字は変えない。
   - `src/import/` には触らない（別の仕事が直している）。`src/app/` は直し終わっているので触らない。
2. 字を固めている試験（vitest・node:test）を新しい字に合わせる。確かめる中身は弱めない。
3. `tests/contract/old-words.test.ts` の見る所に、上の 1 のファイルの文字列（コメントを除く）を足す。縛る語に「仲間」を足す。置き換えが表に無い語は勝手に置き換えず、ALLOWED に理由を添えて入れ、report.md に書く。
4. `MOYAI_WRITE_DOCS=1 npx vitest run tests/contract` で生成の docs を書き直す。

済んだと言える条件：verify が通る。report.md に、直したファイルと字の数、置き換えなかったもの（理由）、足した縛り、試験の数を書く。
