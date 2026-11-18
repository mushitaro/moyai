# 2026-11-18 日誌：Chat から困りごと・開発の要件を頼まれたときの道（作業役）

運営者の困りごと（2026-11-18）：「Chat で開発要件を送ろうとしたら、GitHub のリポジトリに送ろうとしたけど、送れないって。その挙動はちがうでしょ？」。PR #140 で設定の「困りごと」→ 人が「送る」→ 受け口 → Issue `feedback:app` の道はできていたが、AI 向けの文（instructions・1 段目の Skill）にこの道が無く、Claude が GitHub に直接書こうとした。枝 `claude/app-feedback-chat`。統括から頼まれた作業役。

## したこと

1. **道具は足さず、今の `screen_set` の `feedbackDraft` を使う**（理由）：
   - #140 で `feedbackDraft` がもう `screen_set`（作業画面が受ける案の道具）にあり、設定の欄に入れて開くまでの道（`offerFeedbackDraft` → `AppFeedback`）と試験もある。保存先（`storageRoot`）と同じ「欄に置いて開く。押すのは人」の約束にそろう。
   - 道具を足すと、道具の数（21）・予約の名前（`tests/fixtures/reserved-names.txt`）・中継の受け手・`docs/security.md` の表が動き、Claude Desktop が古い定義を持つ間に名前が無い道具が出る。置くだけの道具を別にする益が無い。
   - 送る道具は足していない（送るのは人だけの経路 `app_feedback_send`）。
2. **置く前の形をそろえた**（`src/app/intake/screen-set.ts`）：案を `moyai.app-feedback/0` の一言と同じ関数（`normalizeNote`・`noteProblem`。400 字・20 行・見えない字なし）でそろえ、外れれば置かない（`feedback_invalid`）。行の値・ファイルの道・鍵・URL らしき字（`appFeedbackCounts`）があれば置かず、種類の名前だけを返す（`feedback_values`。値は返さない）。置けなかったときは設定を開かず、`go` も差し替えない。送る前の画面と橋渡しの照らしは今のまま。
3. **AI 向けの文に決まりを書いた**（英語）：
   - `src/shared/instructions.ts`：安全の決まりの 8「MOYAI への困りごと・要望・開発の要件は、設定の『困りごと』に案を置き（feedbackDraft。資料の中身・行の値・施設や会社の名前・鍵・道を入れない）、全文を見て『送る』を押すよう頼む。送るのは人だけ。GitHub（Issue・PR・コメント）に書かない。ほかの道具でも」。instructions は 4,058 字（4,096 字の内）。`screen_set` の名前は Working tools の 1 か所だけのまま。
   - `src/shared/skill-moyai.ts` の Flows：手順（案を書く → `screen_set feedbackDraft` → 利用者に「I put a draft in the Feedback field of Settings. Read the full text and press Send.」と言う → 断られたら書き直す → GitHub の連携・git・gh があっても使わない）。Screens の Settings に「Feedback」。`skills/moyai/SKILL.md` を作り直した。
   - `src/shared/tools.ts`：`screen_set` の説明（開発の要件も。利用者に言う文。GitHub に直接書かない。ほかの道具があっても使わない）・`feedbackDraft` の説明（20 行）・答えの文 `feedback_human_send`（利用者に言う文・GitHub に書かない）・`feedback_invalid`・`feedback_values`。`docs/security.md` を作り直した。
   - `src/shared/tool-names.json` は変えていない（道具を足していない）。
4. **画面は変えていない**ので Wire Frame は足していない（設定の「困りごと」は #140 の絵のまま）。
5. **試験**：
   - unit `tests/unit/screen-set.test.ts`：形にそろえて置く・上限ちょうどは置ける・行が多い・見えない字・空白だけは置かない・上限を超えれば入力の形で断る・置いた案は `buildAppFeedback` → `parseAppFeedback`（canonical）を通る・行の値／道／URL は置かず種類だけ返す・置けなければ `go` は差し替えない・答えに利用者に言う文と「Nothing was sent」と GitHub に書かない文。
   - 文の試験 `tests/contract/app-feedback-text.test.ts`（新）：instructions の 8・1 段目の Skill（関数とファイル）・Flows・`screen_set` の説明と答えの文に決まりがある。道具の名前に send・feedback・github・issue・pull・comment が無い。`app_feedback_send` は人だけの経路。
   - e2e `tests/e2e/app-feedback-send.spec.ts` に 1 本足した：MCP の道具に GitHub に書くものが無い → トップの画面から、道と金額を含む案は置かれない → 案を置くと設定が開き「困りごと」の欄に案と送る全文（画面は top）が出る、送られていない → 人が「送る」を押すと受け口（試験の台）が Issue `feedback:app` を 1 つ。
   - 今の試験は弱めていない。
6. **採点の記録**（`docs/autonomy.md`「Skill の文を変える PR」）：下の「Skill の採点」。

## Skill の採点

`docs/autonomy.md`「Skill の文を変える PR」のとおり、正解を見ていない子の解く役に `SOLVER_BRIEF` をそのまま渡した（API なし）。

| パック | 文の指紋 | 前（main） | 後 | 解く役 |
|---|---|---|---|---|
| ごみ焼却 | `4cbb7a68344ec79a` | 100/100 | 100/100 | 2 つで同じ |
| し尿処理 | `e2f1f6c6eb7ccab2` | 95/95 | 95/95 | 最初の 2 つは 94/95・95/95 で割れた（違うのは R02-09 の数えだけ。#129 の記録と同じ所で、今回の文の変更と関係の無い R02 の数え）。新しい 2 つの役で解き直して 95/95・95/95 |

`node scripts/skill-scores/check.mjs --base origin/main` は手元で両方 ✓。

## 5 つの分け方の報告

- 試験とビルドが通った：手元（Linux）で typecheck・build・check-publish（当たり 0）・`tests/contract`（10 ファイル）・`tests/unit/screen-set.test.ts`（22）・skill-scores の確かめが通った。PR #145 の CI（`5446944`）で test（ubuntu・windows）・e2e（ubuntu・windows）・pack-bench・scenario がどれも緑。手元の全部の試験は 2216 通過・5 落ち（手元の `heldout` の 5 つは、この clone にタグ `reader-freeze-*` が無いための落ちで、#140 と同じ）。
- 画面で動いた：e2e（Linux の Chrome）で、MCP の `screen_set` → 設定の「困りごと」に案と送る全文 → 人が「送る」→ 試験の台の受け口 → 偽の GitHub の Issue まで。CI の e2e（windows）も緑。
- Claude Code で端から端まで通った：未確認（本物の会話で、GitHub を使わずに案を置くかは確かめていない）。
- Windows の実機で動いた：未確認。
- Excel で開いて見やすかった：関係なし。

## 使用量の残り

このセッションから読む道具が無いので未確認。API のキーは使っていない。子のエージェントは、Skill の採点の解く役だけ（6 つ。し尿処理の解き直しの 2 つを含む）。

## 次の一手

- 統括：この PR を見直して main に入れる。入ったあと、Claude Desktop／Claude Code の会話で「MOYAI に開発の要件を送って」と頼み、Claude が GitHub を使わず設定の「困りごと」に案を置くかを 1 回確かめる（未確認）。
- 運営者：受け口の配置し直しとラベル `feedback:app`（#140 の日誌のとおり。まだなら）。
