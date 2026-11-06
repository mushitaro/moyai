---
id: old-words-v2
role: factory
agent: factory
environment: env-kinds
budgetUsd: 15
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs"]
---
# 画面と Claude に見せる文に残った古い言葉（2 回目）

運営者の指示（11-06）：「古い言葉をいつまでも使わないでほしい」。1 回目（old-words-v1）で、印・束・輪・仲間・決定のシートは消えた。`tests/contract/old-words.test.ts` が縛っている。残りは、`docs/words.md` で置き換えが決まっているのに、まだ使っている言葉。

先に読む：`AGENTS.md`、`docs/words.md`（置き換えの表の全部）、`tests/contract/old-words.test.ts`、`src/shared/data-names.ts`（データの名前の正本）。

1. 次の言葉を、`docs/words.md` の言葉に置き換える。見る所は old-words.test.ts の見る所と同じ（画面の字 `src/app/text/`、`src/shared/instructions.ts`・`tools.ts`・`errors.ts`・`data-names.ts`、`packs/*/SKILL.md`・`packs/*/data-names.json`、`skills/moyai/SKILL.md` は `src/shared/skill-moyai.ts` から作る、`src/cli/`・`src/share/`・`src/bridge/`・`scripts/ledger/`・`scripts/demo-ring/` の人に見える字。コメントは直さなくてよい）。
   - 当てはめ → 紐付け（未当てはめ → 未紐付け）
   - 読み方（取り込みのルールの意味）→ ルール。「〜として読む」のような動詞の「読む」は直さない。
   - 検査（照らす機能の名前）→ 照査
   - 合言葉 → ワンタイムトークン（リンクの中の使い捨てのもの）。署名の鍵の合言葉の話なら、words.md を見て合う言葉にする。
   - 単独の「パック」→ Skillパック（「Skillパック」はそのまま。コードの `pack` や JSON のキーは変えない）
   - 似た施設 → 類似施設、段（計画の階層の意味）→ 階層、計量値 → 稼働（記録 → 稼働記録）、共有の見え方の段 → 集約度、帯（値の範囲の意味）→ 階級。帯は「下の帯」（画面の下の状態の帯）だけは残す。
   - 表にほかに置き換えの決まった言葉があれば、それも同じに扱う。
2. 変えないもの：道・ファイル名・id・JSON のキー・型の名前・ツールの名前（`crosswalk_propose`・`reading_rules_propose` などのツール名と kind の値はそのまま）、署名される字（basis の文・LEDGER_SOURCE・CONVERSATION_SOURCE・cond・toItem/toAttr）、共有ファイルの body に入る字、`src/import/` の basis の字。`src/import/` の質問と選択肢の字は直してよいが、決まった答えのルールが `q.text.includes(match)` で当たる（`src/import/questions.ts`）ので、見本の読み方（`samples/` や `tests/` の rules.json の `match`）に当たる字を消さないこと。消すなら見本の match も直す。
3. `src/shared/instructions.ts` の MCP の instructions は 4,096 字が上限（今 4,093 字）。言葉を替えて長くなる分は、同じ節の中の言い方を詰めて収める。決まり 1〜7 の中身は削らない。
4. 字を固めている試験（vitest・node:test・tests/e2e の toHaveText など）を新しい字に合わせる。確かめる中身は弱めない。
5. `tests/contract/old-words.test.ts` の縛る語に、1 で置き換えた語を足す（当てはめ・読み方・検査・合言葉・似た施設・計量値。「パック」は「Skillパック」の中を許す形で）。表に無いのに残すものは ALLOWED に理由を添えて入れ、report.md に書く。
6. `MOYAI_WRITE_DOCS=1 npx vitest run tests/contract` で生成の docs と Skill を書き直す。
7. コミットを 2 つに分ける：`packs/night-soil/` の直しだけのコミット（packs/night-soil/ のファイルだけを含む。tests/packs/pack-second.test.mjs が歴史を見る）と、ほかの全部のコミット。順番は night-soil のコミットを先に。`git format-patch` の 1 つのファイルに 2 つとも入れる。

済んだと言える条件：verify が通る。report.md に、直したファイルと字の数、置き換えなかったもの（理由）、足した縛り、instructions の字数、試験の数、e2e で字を直した所（走らせていないこと）を書く。
