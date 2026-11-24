# 2026-11-24 日誌：止まっていた 4 本の PR（作業役）

統括の頼み（2026-11-23）。11-18〜11-20 から止まっていた draft の PR 4 本（#145・#147・#149・#154）を動かす。枝 `claude/ai-text-combined` と `claude/acceptance-tests`。運営者の手なし。

## したこと

1. **#147（`claude/acceptance-tests`）に main を merge した**（rebase・force push なし。コミット `cb39cbd`）。
   - ぶつかりは `.github/workflows/ci.yml` だけ。#147 の新しい仕事 `install`（windows・ubuntu）と、main の新しい仕事 `acceptance-windows`（受け入れの表。#26）が同じ所に足されていた。2 つは別の仕事なので、両方を残した。試験は弱めていない。
   - 手元（Linux）：型・build・check-publish（当たり 0）・skill-scores ✓。試験の全体で落ちたのは `tests/heldout`（浅い clone で凍結のタグが無いため）だけ。履歴とタグを取って回し直して通った。
2. **#145・#149・#154 を 1 本にまとめた**（枝 `claude/ai-text-combined`。main → #145 → #154 → #147 → #149 の順に merge）。
   - **#149 は #147 の上に積んだ PR**（土台が `claude/acceptance-tests`。#147 のコミットを全部含む。#149 が直す `tests/contract/human-guide.test.ts` も #147 が足したもの）。#147 を除いて #149 だけを入れる道は、rebase か cherry-pick になり、試験のファイルも無い。そこで、1 で main に合わせた #147 を先に merge し、そのあと #149 を merge した。**この PR が入ると、#147 の中身も全部 main に入る**（GitHub は #147 を「マージ済み」として扱う見込み）。
   - ぶつかりは `src/shared/skill-moyai.ts` と `skills/moyai/SKILL.md` の Flows の 1 か所。#145 の「困りごと」の行と、#149 の「画面で人だけがすること」の 7 項目が同じ所に足されていた。両方を残した（困りごとの行が先）。`npm run build` で作り直しても `skills/moyai/SKILL.md` は同じ。
   - **#146 の契約の試験の一時の抜けを外した**：`app_feedback_send`（困りごと）を PENDING から GUIDE に移した。語は #145 の行の「Feedback field of (the) Settings」「press Send」「Only a person sends」。一時の抜けの上限は「1 以下」から「0」にした（狭めただけ）。
3. **合わせた文で、2 つのパックを 1 回ずつ採点した**（`docs/autonomy.md`「Skill の文を変える PR」）。
   - 正解を見ていない解く役 4 つ（パックごとに 2 つ）。頼みの文は `SOLVER_BRIEF` のまま。
   - 前の回（#149）で、並べて走らせた役が同じ名前の作業用スクリプトを書いた。今回は 1 つずつ順に走らせ、役と役のあいだで scratchpad の作業用のファイルを消した。
   - ごみ焼却：100/100（解く役 2 つとも 100）。指紋 `0d8325023e694f99`。main（#143 の記録 `e8ebc166bf5431bf`）は 100/100。
   - し尿処理：95/95（解く役 2 つとも 95）。指紋 `bcae16f3a65e6831`。main（#143 の記録 `662ba071b454a384`）は 95/95。1 組目で割れなかった（R04 は 5/5）。
   - `scripts/skill-scores/check.mjs --base origin/main`：2 つとも ✓（下がっていない）。
   - 3 本の枝が置いた、合わせる前の文の記録（6 つ）は、履歴として残した。

## 5 つの分け方の報告

- 試験とビルドが通った：
  - `claude/ai-text-combined`：手元（Linux）で、型・build・check-publish（当たり 0）・skill-scores ✓・試験の全体（vitest 2242 通過・19 飛ばし・落ちた 0、node:test 238）。CI は PR で見る。
  - `claude/acceptance-tests`：CI で test（ubuntu・windows）・install（ubuntu・windows）・pack-bench が緑。e2e は PR で見る。
- 画面で動いた：画面のコードの変更は 3 本の PR のまま（#145 の `screen_set` の `feedbackDraft`）。e2e は CI で見る。手元では走らせていない（橋渡しを 127.0.0.1 に起こすため）。
- Claude Code で端から端まで通った：未確認（本物のモデルの会話。3 本とも同じ未確認の項目）。
- Windows の実機で動いた：未確認（CI の windows だけ）。
- Excel で開いて見やすかった：関係なし。

## 使用量の残り

このセッションから読む道具が無いので、未確認。API のキーは使っていない。解く役 4 つ。

## 次の一手

- 統括：`claude/ai-text-combined` の PR の表を見直す。入れたら #145・#149・#154 を閉じる。#147 は中身が全部入るので、残っていれば閉じる。
- #154 は、自分の本文に「パックの Skill の文の変更は Skill の昇格。入れるのは運営者」と書いていた（`docs/autonomy.md` のアプリの困りごとの節の「人だけの決まり」にも Skill の文がある）。統括が入れてよいかを、統括が `docs/autonomy.md` §3 の 6 と照らして決める。
- 1 が入る前に main が動いたら、両方の枝にもう一度 main を merge する。
