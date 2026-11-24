# 2026-11-24 日誌：連携のデモ（架空の Maximo）と、作業画面をブラウザの道具で触らない決まり（作業役）

統括の頼み（2026-11-24）。運営者が M-PC3 の Claude Desktop で困ったこと 2 つ：
1. 「Maximo との連携のデモを設定して」に、Claude が「つなぎ先が 1 件も無い。足す道具が無い」と答え、連携のデモができなかった。
2. Claude が MOYAI の道具を使わず、Claude in Chrome で作業画面（127.0.0.1:43110）をクリックして、取り込みの画面を開いた。

枝 `claude/connect-demo`、PR #159（draft）。

## したこと

### A. 連携のデモ（架空の Maximo）

- **AI の道具 `connect_demo`**（22 個目）：橋渡しのメモリの中だけの架空の Maximo を、テスト環境のつなぎ先として 1 つ足す（`src/bridge/connect/demo.ts`）。
  - 行き先は予約のオリジン `https://demo-maximo.moyai.invalid`（`.invalid` は DNS に出ない）だけ。部品の MaximoClient に渡す fetch が、ほかのオリジンへの要求を送る前に断る。橋渡しの網（globalThis.fetch）は使わない。
  - API キーは無い。状態フォルダにも、部品の接続の保存（`~/.config/mxstage`）にも書かない。橋渡しを起こし直すと消える（もう一度 `connect_demo`。`reset: true` で初めの中身に戻す）。
  - 連携がオフなら足さない。`refused: connect_off` と、人にオンを頼む 1 文を返す（オンにするのは人だけ、の約束は変えていない）。連携の道具（`connect_read`・`connect_plan`）と違い、オフでも一覧に出る。
  - 引数は `pack` と `reset` だけ。本物のつなぎ先の URL・鍵・本番を渡す欄は無い（型で断る）。本物のつなぎ先を足すのは今までどおり人だけ（`connect_add`）。
  - 部品の MX Stage の demo の出口（`DEMO_CONNECTION_IDS`・`isReservedDemoHost` など）は使っていない。このセッションの網では部品を取れず（`codeload` が 403、リポジトリを足す道具も断られた）、その出口の形を確かめられなかったため。MOYAI の予約のオリジンは MOYAI が持つ（`isDemoOrigin`）。
- **読み書きの道は 2 つ**。どちらも同じ中身を、同じ数で読む（単体の試験で確かめる）。
  - 部品と、その `/testing` の偽の Maximo（`createFakeMaximo`）があるとき：本物のつなぎ先と同じ Maximo の読み書き（`package.ts` から `maximoConnector` に切り出した）で読む・書く。CI はこちら。
  - 無いとき：芯のメモリの中の架空の Maximo。手元（この網）はこちら。
- **中身**：`packs/waste-incineration/demo/maximo.json`（業種の語はパックに置く）。資産の道 6・PM 6・作業の実績 5、どれも【架空】。デモの施設（【架空】さくら坂焼却場）の 3 つの資料から、今の読み手で作った計画の行（27 行。手元で一度通して読んだ）に合わせ、一致 3・食い違い 2（年度）・Maximo だけ 1 にした。
  - 読み手が変わって計画の行の道が変わると、一致・食い違いが「片方だけ」になる（それでもデモは通る）。
  - 現場の Maximo には施設の資産の木がもうある。その代わりに、書き込みの案を作る前に、確定した版の資産の道を架空の Maximo の資産の木に足す（`align`）。これが無いと、資産の木に無い資産の計画は書けない（`connectUnwritable`）ので、デモが止まる。
  - `maximo.json` はデモの資料ではないので、`intake_add_files`（source: demo）には入らない。
- **混ぜない**：架空の Maximo から読んだ資料は、利用者の資料・架空でない資料のある作業画面に入れない（`connect_read` の `refused: mixed`。デモの資料と同じ決まり）。入れたものにはデモの印を付ける。
- **作業画面の側**：`connect_read`・`connect_plan` は毎回つなぎ先を読み直す（`connect_demo` で足したものが出るように）。
- **設定の「連携」の欄**：部品が無くても、デモの中身のある Skillパックがあれば出す（人がオンにできるように）。
- **デモの流れ**：連携の段は、上の「デモ」の段（`tests/demo/walkthrough-flow.ts`）に**足していない**。チャットのデモを短く保つため（連携は頼まれたときだけ）。連携のデモを頼まれたときの道を、1 段目の Skill の「Integration demo」の節、`packs/waste-incineration/demo/README.md`「連携のデモ」、`connect_demo` の説明と答えの note に書いた。
- **画面**：新しい欄・ボタンは足していない（足すのは AI の道具。画面は見て確かめる面のまま）。変わったのは、連携のシートに出る断りの 1 文（`demoMixed`）と、設定の一覧に架空の Maximo の行が出ることだけ。どちらも今の部品の中なので、Wire Frame の絵は足していない。

### B. AI は作業画面をブラウザ・画面操作の道具で触らない

- instructions の決まり 6 に、英語で、「Reply to the user in the user's language」の形のまま書いた：作業画面（127.0.0.1）は MOYAI の道具（intake_survey・chart_rows …）だけで読み・見せる。ブラウザ・computer use（Claude in Chrome・computer use）で開く・押す・読むことをしない。見せるのは intake_survey の show。道具が見えないとき（開き直しの直後など）はブラウザに回らず、待って一覧を見直すか、Claude を開き直すよう 1 行で頼む。
  - instructions は 4,096 字で切れるので、ほかの行を縮めて 4,081 字にした（中身は変えていない：データの名前・確定した版・ほかの流れ・取り込みの流れの行）。
- 1 段目の Skill に節「The work screen and browser tools」を足した。Install の 8（作業画面を開く）を intake_survey の show にした。
- intake_survey の説明にも同じ決まりを書いた（Claude Desktop は instructions を読まないので、道具の説明が効く）。
- 契約の試験 `tests/contract/work-screen-tools.test.ts`：instructions・SKILL.md・intake_survey の説明に、この決まりがあることを確かめる。

### Skill の採点（`docs/autonomy.md`「Skill の文を変える PR」）

- 正解を見ていない解く役 4 つ（パックごとに 2 つ）。頼みの文は `SOLVER_BRIEF` のまま。
- 前の回で、並べて走らせた役が同じ名前の作業用スクリプトを書いた。今回は 1 組目を並べて走らせ、そのあと scratchpad の作業用のファイルを消してから、2 組目を 1 つずつ走らせた（役と役のあいだでも消した）。
- ごみ焼却：100/100（解く役 2 つとも 100）。指紋 `540c00e93bd3c41e`。main は 100/100。
- し尿処理：95/95（解く役 2 つとも 95）。指紋 `1c7eb799c13452bf`。main は 95/95。1 組目で割れなかった。
- `scripts/skill-scores/check.mjs --base origin/main`：2 つとも ✓（下がっていない）。

## 5 つの分け方の報告

- 試験とビルドが通った：手元（Linux）で、型・build・check-publish（当たり 0）・skill-scores ✓・試験の全体（落ちたのは `tests/heldout` の 5 つだけ。この clone に凍結のタグが無いため。前の日誌と同じ。変更とは関係ない）。CI は PR #159 で見る。
- 画面で動いた：手元の e2e（Playwright の chromium）で `tests/e2e/connect-demo.spec.ts` の 2 本が通った（芯のメモリの道）。部品の偽の Maximo の道は CI だけ（この網では部品を取れない）。
- Claude Code で端から端まで通った：未確認（本物のモデルの会話。「Maximo との連携のデモをして」で connect_demo を選ぶか、ブラウザの道具を使わないかは、文と試験の台本でしか確かめていない）。
- Windows の実機で動いた：未確認（CI の windows だけ）。
- Excel で開いて見やすかった：関係なし。

## 使用量の残り

このセッションから読む道具が無いので、未確認。API のキーは使っていない。解く役 4 つ。

## 次の一手

- CI（test・e2e ubuntu/windows・pack-bench・scenario・install・acceptance）を緑にする。部品の偽の Maximo の道（単体の試験の 3 つと e2e）は CI で初めて走るので、落ちたら直す。
- 統括：PR の「チェック項目と証拠」の表を見る。「本物の Claude Desktop で、連携のデモを頼むと connect_demo から進む」「ブラウザの道具で作業画面を触らない」は未確認で残る。運営者の PC で 1 回試してもらうかは統括が決める。
- 部品の demo の出口（`isReservedDemoHost` など）の形が分かれば、MOYAI の予約のオリジンを部品の出口でも確かめるかを決める（今は MOYAI の `isDemoOrigin` だけ）。
