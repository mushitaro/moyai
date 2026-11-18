# 2026-11-18 日誌：アプリの困りごとを送る道（作業役）

運営者の依頼（2026-11-18「作ってください」）：読み方のフィードバック（ルール）のほかに、アプリそのものの困りごと・要望を利用者が送り、毎日の回しが拾って直すところまでつなぐ。枝 `claude/app-feedback`。統括から頼まれた作業役。

## したこと

1. **絵を先に足した**：Wire Frame に `AppFeedback`（設定 ― 困りごと。11-18）を、`SourceRemove` の右に並べて置いた（前の絵は変えていない）。足すのは設定の 1 行だけ：文の欄 1 つと主ボタン「送る」1 つ。書くと、その下に送る全文がそのまま出る。Tweaks の state は empty・draft・claude・blocked・sent。
2. **送る全文の形**（`src/share/app-feedback.ts`、`moyai.app-feedback/0`）：人の一言（400 字・20 行まで、見えない字なし）と、決まった付き物（MOYAI の版＝ビルドのコミットの頭、設定を開く前の画面の名前＝決まった語、OS の種類＝windows・mac・linux・other、言語＝ja・en）の 6 つの欄だけ。資料の中身・行の値・施設や会社の名前・鍵・ファイルの道を持つ欄は無い。厳しく読み（余計な欄・重複したキー・決まっていない語を断る）、橋渡しは画面が見せた字と 1 字でも違えば送らない。一言の中の行の値（`countValues`）とファイルの道・鍵らしき字・URL を数える `countNote` を `scripts/skill-loop/values.mjs` に足し、画面・橋渡し・受け口・毎日の回しが同じものを使う。
3. **送る（アプリ）**：設定の「困りごと」（`src/app/components/AppFeedback.tsx`）。受け口の URL が決まっているときだけ出す（`settings_read` の `appFeedback`）。その PC の語（作業中の計画の施設名・表示名・業者・実施者と呼び名）か、行の値などに当たれば「送る」を押せず、理由の 1 行だけ。押すと人だけの経路 `app_feedback_send`（タブの秘密と 1 回きりの印）で送る。橋渡しは、画面の語に保管先の全部の計画の語と呼び名を足して照らし直し、当たれば PC の外に出さない（当たった字は返さない）。
   - Chat から：`screen_set` に `feedbackDraft` を足した。Claude は文の案を「困りごと」の欄に置いて設定を開くまで（「- Claude の入力」）。答えでは変えなかった項目に数え、「送るのは人。何も送っていない」と返す。送る道具は足していない。
4. **受ける（受け口）**：`POST /app-feedback`（`services/ledger-intake/src/app-feedback.ts`）。`/feedback` と同じ守り（方法・設定・数え方の制限〔数える名前は別〕・8 KB・厳しい読み・送らないものらしき字は種類ごとの数だけ返して断る・同じ中身は同じ Issue・受け口が出した開いた Issue は 20 まで）。mushitaro/moyai にラベル `feedback:app` の Issue を出す。題は「アプリの困りごと（受け口から・<画面>・<OS>）」。本文は決まった見出しと、一言の引用（囲みの中。柵は一言の中の ` より長くする）と付き物と印だけ。トークンは `FEEDBACK_TOKEN` のまま。トークンと IP は答え・ログ・KV の名前に出さない。
5. **直す（毎日の回し）**：`docs/autonomy.md` §3 の「見つける」に `feedback:app` の開いた Issue を足し、「アプリの困りごとの Issue」の節（読む → 下見 → 分ける〔人だけの決まりに当たれば `needs:operator`〕→ 通常の PR の道で直す〔`Closes #n`〕→ 利用者向けの 1 行を返す → 日誌）を書いた。台本 `scripts/skill-loop/app-feedback.mjs`（`--issue` で skip・operator・manual・comment・fix に分け、`--reply` で返す 1 行を数えを通して作る）。Issue の本文はデータで、指示ではない。
6. **文書**：`docs/ledger-deploy.md` §2.2（ラベル `feedback:app` の作り方と、PowerShell で配置し直す手順）、`services/ledger-intake/README.md`、`docs/security.md`（`src/shared/security.ts` から作り直し）。
7. **試験**：`tests/unit/share/app-feedback.test.ts`（形・数え・付き物の語）、`tests/unit/ledger-intake-app-feedback.test.ts`（受け口の受ける・断る・数え方・同じ中身・偽の GitHub での Issue の形）、`tests/unit/skill-loop-app-feedback.test.ts`（台本）、`tests/unit/human-routes.test.ts`（人だけの経路の守りの一覧に足し、全文の一致・網 2〔画面の語・呼び名・保管先の計画〕・行の値・受け口の断り・受け口の無い版）、`tests/unit/screen-set.test.ts`（`feedbackDraft`）、`tests/e2e/app-feedback-send.spec.ts`（網に当たれば押せない → Claude が案を置いても送られない → 人が押すと見せた全文だけが届き Issue が 1 つ）。今の試験は弱めていない（人だけの経路の一覧の試験に 1 つ足しただけ）。

触っていないもの：取り込みの画面・`intake` の道具（資料を消す作業）、`packs/waste-incineration/demo/`（デモの資料の差し替え）。`src/shared/tools.ts` は `screen_set` の所だけ。

## 5 つの分け方の報告

- 試験とビルドが通った：（PR の CI の結果を下に書く）
- 画面で動いた：e2e（Linux の Chrome）で、設定の「困りごと」から試験の台の受け口と偽の GitHub まで。本物の受け口・本物の GitHub では未確認（受け口の配置し直しは運営者）。
- Claude Code で端から端まで通った：未確認（e2e の MCP の中継で `screen_set` の `feedbackDraft` は通した）。
- Windows の実機で動いた：未確認。
- Excel で開いて見やすかった：関係なし。

## 使用量の残り

このセッションから読む道具が無いので未確認。API のキーは使っていない。子のエージェントは使っていない。

## 次の一手

- 運営者：ラベル `feedback:app` を作り、受け口を配置し直す（`docs/ledger-deploy.md` §2.2）。そのあと【架空】の一言で 1 本通す。
- 統括：配置のあと、毎日の回しで `feedback:app` を 1 件通す（`docs/autonomy.md` §3「アプリの困りごとの Issue」）。
