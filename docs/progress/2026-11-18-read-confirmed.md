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

## Skill の文の採点（docs/autonomy.md「Skill の文を変える PR」）

1 段目の文（instructions と流れ）を変えたので、CI の `scripts/skill-scores/check.mjs` が、2 つのパックの今の文の記録が無いとして落ちた（統括が知らせた）。手順どおりに、正解を見ていない別々の解く役（子のエージェント）が、書き出したフォルダだけを読んで解き、コードで採点した。

- し尿処理：95/95・95/95 → 記録 `eval/skill-scores/night-soil/49c45a7044df2eaf.json`（main 95/95 → 95/95）
- ごみ焼却：最初の組は 100/100・97/100 で割れた（記録を作らない）。違いは 3 問とも R03 の「計画の年数」の検査の出典（パックの文が「表Ⅱ-12 を挙げつつ、年数は app の目安」と書くので、URL と null の 2 通りに読める。解く役 2 つとも迷いとして知らせた。この PR で変えていない 2 段目の文）。新しい 2 つの役で解き直して 100/100・100/100 → 記録 `eval/skill-scores/waste-incineration/173da9c1d8ddbc60.json`（main 100/100 → 100/100）
- 手元で `node scripts/skill-scores/check.mjs --base origin/main` が通った。

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
- ごみ焼却の 2 段目の文の「計画の年数」の出典の書き方が 2 通りに読める（採点が割れた）。直すなら別の PR で（2 段目の文の変更なので採点し直す）。
- 確定版の行に施設の見せ方（行の並べ替え）を効かせるかは未定（見せ方は作業画面のブラウザにある。要るなら作業画面が見せ方を渡す形にする）。

---

# 続き：施設の名前が変わらない・確定のあと次の版の編集のままになる（運営者が M-PC3 で見つけた。統括が頼んだ）

枝は `claude/facility-name-after-confirm`（#138 の枝から切った）。

## したこと

### バグ 1：工場（施設）の名前を変えられない
- **再現**（e2e `tests/e2e/facility-name-confirm.spec.ts` と、調べるための一時の台本）：Claude が chart_propose の facilityName で案を置く → 確定のシートに「施設の名前　前 → 後」が並ぶ → 人が受けて署名して確定。次の 3 つの道で、どれも**版の記録・MOYAI のトップの行・HOSHITORI の見出しは新しい名前になった**（データの道は落ちていなかった）：
  1. 新しい施設の第 1 版で名前を直す
  2. 第 1 版を確定したあと、同じタブで続けて名前を直して第 2 版
  3. トップの「＋ 次の版」で開き、名前を直して第 2 版
- 落ちていた所（運営者が見たもの）：
  - 確定のシートで名前の行の「確定」を押しても、**見出しは署名するまで前の名前のまま**だった（名前が替わるのは署名した版から）。シートの「確定」と、ダイアログの「署名して確定する」が同じ「確定」の字で、受けただけで名前が変わったように見えない。
  - 新しいタブで「＋ 次の版」を開くと、作業画面の施設の設定（パック・名前・年度の始まり・架空の印）が**開いた版のものにならず**、空か前のタブの値のまま組み直していた（新しいタブで組み直すと前の名前・空の名前になり得る。下の直しを入れる前は、組み直しが止まった）。
- 直し：
  - 見出しの名前の右に「→ 新しい名前　確定前」（朱）。名前の案を確定のシートで受けたあと、署名の前だけ（Wire の AfterConfirm の header）。
  - 版を開いたら（`restoreFrom`）、作業画面の施設の設定を開いた版の計画から置く（名前は確定した版の名前）。
  - 【架空】の施設は【架空】の印を外せない（今の決まりのまま。e2e で、印の無い案が断られることを見る）。

### バグ 2：署名して確定したあと、次の版の編集の画面のままになる
- 先に Wire Frame に絵を足した：artboard `AfterConfirm.dc.html`（state：dialog・top・header）と付箋 `afterConfirm1118`。前の絵（Main・Handoff・Decisions・HoshitoriOut）は消していない。
- 直し：確定のダイアログを閉じると、作業中の写しを書く手を止め、その施設の作業中の写しを消し（確定した版が中身をすべて持つ）、MOYAI のトップを読み込み直す（`src/app/state/after-confirm.ts`。Merge と星取表の両方）。トップには確定した版の行が見え、「作業中」の印は出ない。次の版は、人が「＋ 次の版」を押したときだけ開く。
  - 署名の直後（受けた決定を消すところ）で写しが書き直されて、トップに「作業中　未確定 n」が残っていたので、署名した時点で写しを書く手を止める。
- 画面の約束の変わる所：11-10 の HoshitoriOut（確定 → 出力 → 共有を HOSHITORI の中で）は、確定のあと一度トップに戻り、「＋ 次の版」（いちばん新しい版を開く）から出力・共有のシートへ行く形になる。運営者の言葉（「MOYAI に戻るでしょふつう」）に合わせた。
- 試験：e2e で、確定のあとトップに戻る・行に新しい名前・「作業中」が無い・AI の chart_rows が source: confirmed（作業中の計画が勝手に開かれない）・「＋ 次の版」で見出しが新しい名前のまま。確定のあと HOSHITORI を続けて使う e2e（checkpoint・claude-code・connect・ledger-intake・ledger-pr・share-preview・slice・star-removal-next）は、`closeConfirmAndReopen`（閉じる → トップ → 「＋ 次の版」）で人と同じ道をたどる形に直した。walkthrough（`tests/demo/walkthrough-flow.ts`）は、閉じたあとトップが出ることを足した。

### 見つけた、前からあるバグ（この PR では直していない）
- 同じ版を「＋ 次の版」で 2 回開く（トップ → ＋ 次の版 → トップ → ＋ 次の版）と、2 回目に「第 1 版の資料を読んでいます」の止め札が残り、作り直しが failed になる。main でも同じ（slice の台本で 2 往復させて確かめた）。確定のあとトップに戻る形にしたので、出会いやすくなる。次の一手に書く。

## 5 つの分け方の報告（続き）
- 試験とビルドが通った：手元（Linux）で typecheck・build。e2e chrome は下の「試験」。windows は PR の CI で見る。
- 画面で動いた：Linux の Chrome（Playwright）で、確定 → トップ → 新しい名前の行 → 「＋ 次の版」 → 見出しが新しい名前、を通した。「確定前」の 1 行も e2e で見た。
- Claude Code で端から端まで通った：MCP のクライアント（本物の中継と橋渡し）で、chart_propose の facilityName から確定まで e2e で通した。Claude Desktop では未確認。
- Windows の実機で動いた：未確認。
- Excel で開いて見やすかった：関係なし。

## 次の一手（続き）
- 同じ版を 2 回開くと止まるバグ（上）を直す（別の PR）。
- 運営者の M-PC3 で、デモ → 確定 → トップ → 「＋ 次の版」 → 名前の案 → 受ける（見出しに「確定前」）→ 署名 → トップの行が新しい名前、を通す。
