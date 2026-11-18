# 2026-11-18 日誌：資料を消す（画面とチャット）

運営者の困りごと（2026-11-18）：「デモで別の資料に入れ替えようとしたが、Chat から資料が削除できないし、画面でも削除できなかった」。
今までは消す道が無く、作業画面のタブを読み込み直して全部を消すしかなかった（`DEMO_MIXED_NOTE` の "There is no button to remove files from the work screen."）。枝 `claude/remove-files`。

## したこと

1. **Wire Frame に絵を足した**（前の絵は変えていない）：`SourceRemove.dc.html`（11-18 の行の右端、x 12160）と付箋 1 つ。資料の選びの一覧の行の右端に小さな「消す」を 1 つだけ。押すと同じ所が朱の「消す？」、もう一度押すと消える（窓は出さない）。Tweaks の step で list・ask・removed。
2. **作業画面**（`src/app/intake/workspace.ts` の `removeFiles`、受け手 `intake-host.ts` の op `remove`）：
   - 持っていない名前が 1 つでもあれば、どれも消さない。読込・計画づくり・決定の途中は消さない（busy）。
   - 残りの資料で取り込みを作り直し（資料ごとの覚えを使うので読み手は走らせ直さない）、残った問いにかかる決定だけを置き直す。消した資料にだけかかる問いと答えは外れる。写真と、PDF の文字の無い頁（「名前#p頁」）は写真の一覧から外す。デモの印・出どころ・「第 n 版の資料」の印も、消した資料の分だけ外す。
   - 作業中の計画があれば、**今の道**（`startCompose`）で作り直す。行・当てはめ・下書きは、作り直した計画に残るものだけが残る（当てはめの引き継ぎは今の `placeComposedPlan`）。残りの資料に答えていない問いが出て作れなければ、今までどおり「作り直していません」で署名が止まる。
   - 資料が 1 つも残らず、作業中の計画が確定した版をもとにしていなければ（`base === null`）、作業中の計画も消す。版をもとにしていれば残す（作り直すまで署名は止まる）。確定した版・版の履歴・保管先・署名・鍵・ディスクの資料には触れない。
   - 画面（`SourcePicker.tsx`・`Merge.tsx`）：読めた資料の行に「消す」→「消す？」。古い版を見ているとき（viewOnly）は出さない。消したら作業の欄に 1 行（「資料を消しました「…」（外れた答え n 件）」）。
3. **チャット**：道具 `intake_remove_files`（21 個目。経路の種類は `"tab"`。作業画面が人の「消す」と同じ関数で消す）。
   - 入力：`files`（作業画面の名前、1〜200）と `apply`（真偽）。出力：`applied`・`removed`・`files`・`unknown`・`touching`（かかる問いの数と答えの作者ごとの数）・`dropped`・`filesLeft`・`plan`（recomposing・cleared・kept）・`refused`（unknown・busy・human_decided）・`note`。名前と数だけで、セルの値は返さない。
   - **確かめの形を「返りで示す」にした理由**：`intake_add_files` などの intake の道具は、作業中のものを人の確かめなしで変える "propose"（案を置く）で、人だけの経路（確定・署名・次の版・送る）は使っていない。消すのも作業中の資料だけで、確定した版には触れない。そこで新しい人だけの経路は足さず、`apply` なしで「どの資料をいくつ、かかる問いと答えがいくつ」を返して何も消さず、利用者が会話でよいと言ってから `apply: true` で消す 2 段にした。道具の説明・note・1 段目の Skill にこの順を書いた。
   - ただし、**人が画面で答えた問いにかかる資料は、AI からは消さない**（`refused: human_decided`）。今の決まり「人が画面で答えた問いは、人だけが変えられる」（`intake_settle`）に合わせた。人は画面の「消す」で消せる。
   - 名前に確定・送るの語は無い（`apply` は引数の名前。契約の試験の名前の検査は変えていない）。
   - AI の文は英語。どの道具の説明にも付く "Reply to the user in the user's language" をそのまま使う。
   - 合わせたもの：`src/shared/tool-names.json`、契約の試験（`tests/contract/contract.test.ts` の数 21 と "tab" の一覧）、`tests/unit/relay.test.ts`・`tests/unit/screen-set.test.ts` の数、`tests/scripts/reserved-names.test.mjs` の上限（21）、instructions の「Working tools」と 7 番、1 段目の Skill（`src/shared/skill-moyai.ts` → `skills/moyai/SKILL.md`。デモの入れ替えの手順・利用者の資料の 4 と 6）、`docs/security.md`（ツール定義から作り直し）、`docs/screens.md` 3.2。
   - デモの文（`DEMO_MIXED_NOTE`）を、消す道（`intake_remove_files` か一覧の「消す」）を指す形に直した。`intake_demo_mixed`（ほかの Skillパックが選ばれているとき）の文は、資料を消しても Skillパックは替わらないので変えていない。
4. **試験**：
   - unit `tests/unit/intake-remove-files.test.ts`（11 件）：消すと行・問い・答えが外れ、作り直した計画に消した資料の行が無い／確定した版の中身は変わらない（版をもとにした作業中の計画は消さない）／資料が残らず版をもとにしていなければ作業中の計画も消える／知らない資料は断る（どれも消さない）／dryRun は消さない／デモの印／道具の 2 段（apply なしは数だけ）／知らない名前／人が画面で答えた問いの資料は AI から消さない／読込の途中は busy／道具の形（instructions・SKILL.md・英語の note・型）。
   - e2e `tests/e2e/remove-files.spec.ts`：画面の「消す」→「消す？」→ 消える／チャットの apply なし・apply: true／知らない名前を断る／消した資料はディスクから消えず入れ直せる。資料は一時のフォルダの架空の CSV（デモの資料の中身によらない）。
   - 今の試験は弱めていない（数を 20 → 21 にしただけ。断る試験・名前の検査はそのまま）。
5. 触っていないもの：`packs/waste-incineration/demo/` とデモの試験（別の作業役が v4 に差し替え中）、変換の精度、タグ `submission`・枝 `hackathon-release`。

6. **Skill の文の採点**（1 段目の文を変えたので。`docs/autonomy.md` の「Skill の文を変える PR」）：正解を見ていない別々の解く役（子のエージェント、決まった頼みの文のまま）2 つずつで解き、コードで採点した。ごみ焼却 100/100 → 100/100（2 役とも同じ）、し尿 95/95 → 95/95（2 役とも同じ）。記録 `eval/skill-scores/waste-incineration/993f224ff92de56c.json`・`eval/skill-scores/night-soil/93af071b726ff190.json`。

## 消したあとに問いが増えることがある

工場の資料（fictional-1）で `daily-report.csv` を消すと、外れた問いのほかに、残りの資料の問いが新しく出ることがあった（資料をまたぐ問いの形が変わるため）。そのときは作り直しが止まり、署名も止まる（今の「作り直していません」）。試験は、止まったら答えて作り直し、消した資料の行が無いことを確かめる形にした。

## 5 つの分け方の報告

- 試験とビルドが通った：手元（Linux）で typecheck・build・check-publish・新しい e2e（chrome）・Skill の採点の検査が通った。vitest の全体は手元で 2147 通過・落ちた 6 のうち 5 は浅い clone の heldout（CI の ubuntu では通った）、1 は写真の試験の一覧（直した）。CI の test（ubuntu）では vitest 2153・node:test 237 が通った。e2e の全体と windows は PR の CI の結果で見る。
- 画面で動いた：e2e の中の Chrome で、一覧の「消す」→「消す？」→ 消える を確かめた（写しは e2e の写しの所。目で見た）。
- Claude Code で端から端まで通った：未確認（MCP の道具は e2e の中継で呼んだ。本物の Claude Code では呼んでいない）。
- Windows の実機で動いた：未確認。
- Excel で開いて見やすかった：関係なし。

## 使用量の残り

このセッションから読む道具が無いので未確認。

## 次の一手

- 本物の Claude Code で「デモの資料を消して、このフォルダの資料に入れ替えて」を通す。
- 消したあとに出る新しい問いを、会話でまとめて聞けるか（今は intake_survey で読み直す）。
- `intake_demo_mixed`（ほかの Skillパック）のときに、作業画面を空にしたあと Skillパックを替える道（今は読み込み直し）。
