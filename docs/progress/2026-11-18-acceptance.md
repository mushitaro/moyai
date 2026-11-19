# 2026-11-18 受け入れの試験（利用者と同じ道を CI で通す）

統括から頼まれた分。運営者の指摘（11-18）：CI が緑でも、運営者の Windows の PC で動かないものを「できた」と伝えた。
- 連携の部品が Windows の PC に入らなかった（取り先が git+ssh・部品の prepare の rm -rf。#141 で直した）
- 設定の「困りごと」（#140）を AI 向けの文に書いておらず、Chat の AI が GitHub に直接送ろうとした（別の作業役が直し中）
- 自動の更新が 5 日間切り替わらず、古い版のままだった

利用者と同じ道を通す試験を 4 つ足し、次から CI で止める。

## したこと

1. **入れ方の受け入れ**（CI の新しい仕事 `install`。windows と ubuntu）：`tests/acceptance/install.spec.ts`・`playwright.acceptance.config.ts`
   - CI が checkout したコミットを一時の裸の git に写して main にし、そこからの一時の clone で `moyai setup --yes` を走らせる（外の main は取らない）。
     setup が版のフォルダで 取得 → `npm ci`（スクリプトあり）→ `npm run build` → 自己点検 をする。test の仕事の `npm ci --ignore-scripts` では通らない道。
   - 確かめる：版のフォルダと印・current.json・取ってくる先・Claude Desktop の設定（一時のファイル）が起動の台本を指す・送信者の名前・
     連携の部品（本体・/node・/license・/eam）が版のフォルダから読める・起動の台本から起こした橋渡しの設定に「連携」が出る（`connect.available` が true のときだけ出る欄）・
     起動の台本の中継から MOYAI のツールが出て、人だけの操作の道具は無い。
   - HOME・USERPROFILE・APPDATA・LOCALAPPDATA・XDG_*・MOYAI_APP_DIR・状態フォルダ・Claude Desktop の設定は、どれも一時のフォルダ。
2. **本物の部品と偽の Maximo の e2e**：`tests/e2e/connect-maximo.spec.ts`（e2e の仕事に入る。ubuntu と windows）
   - 部品の `/testing` の `createFakeMaximo` を、試験の中だけ一時のポートの HTTPS で立てる（`tests/helpers/fake-maximo.ts`。部品は https のつなぎ先しか受けないので、
     一時のフォルダに自分で署名した証明書を作り、橋渡しにだけ `NODE_EXTRA_CA_CERTS` で足す）。
   - 橋渡しは `MOYAI_CONNECT_PACKAGE` を off にせず部品を読む。HOME（Windows は USERPROFILE）を一時のフォルダにして、部品の接続の保存（`~/.config/mxstage`）をそこに置く。
   - 設定で連携をオン → 「足す」でつなぎ先（テスト環境）→ HOSHITORI の連携のシートで「読む」→ 計画 → 確定・署名 → 突合と差分（足す・変えるの数を、確定した版から数えた値と照らす）→ 人が「送る」→ 読み直した差分が 0。
   - 現場の Maximo には施設の資産の木がもうあるので、試験は確定した版の資産の木を、送る前に偽の Maximo に入れる（部品は資産の木に無い資産の計画を書かない）。
   - 合わせて vitest `tests/unit/connect-https.test.ts`（test の仕事。ubuntu と windows）：別のプロセスで、部品の ConnectionStore に保存（Windows は DPAPI）→ 開く → 部品の MaximoClient が HTTPS の偽の Maximo を読む。証明書を足さなければ読まない（TLS の確かめを緩めていない）。
3. **人だけの操作の案内**（契約の試験）：`tests/contract/human-guide.test.ts`
   - `HUMAN_ACTIONS` の 49 の経路を、案内あり 13（AI 向けの文の 1 行に、画面の場所と人が押すことの語がそろう）・案内の要らない理由つき 26・一時の抜け 10 に分ける。どれにも入らない経路を足すと落ちる。
   - 一時の抜け（`PENDING`）は「まだ書いていない」ものだけを許す。書いたら GUIDE に移さないと落ちる。
   - **困りごと（`app_feedback_send`）は一時の抜けに入れた。別の作業役（困りごとの AI 向けの文を直す PR）がその PR で外す。** 語は `Settings`・`feedback|trouble|problem`・`Send` が 1 行にそろうこと。別の語で書いたら、その PR で語を合わせる。
   - ほかの 9 つ（つなぎ先を足す・前の版に戻す・作業中を消す・頼み直す・様式で書き出す・様式を置く・ルールを書き出す・ルールを送る・コメント）は #146 にした。Skill の文を変えると 2 つのパックの採点の記録が要るので、この PR では書いていない（困りごとの PR と同じ回にまとめれば採点が 1 回で済む）。
4. **自動の更新が切り替わるか**：`tests/unit/app-update-switch.test.ts`
   - 今の試験は、用意（next を置く）と起動の台本（next を current に）を別々に見ていた。1 本につなぐ：setup が版 1 を入れる → 起動の台本で版 1 → 版 2 を自動の確かめが裏で用意 → 次の起動で版 2 の cli.js が本当に起きる → 版 3 で前の版を 1 つだけ残す。
   - 作れない版（build で落ちる）・自己点検で版を言えない版には替えない。直った次の版には替わる。
   - git・起動の台本・版の cli.js は本物（node で起こす）、npm だけ差し替え。本物の npm ci と build は 1 の受け入れが通す。

## 5 つの分け方の報告

- 試験とビルドが通った：手元（Linux）で、ビルド・型の検査・公開の前の検査（当たり 0）・`node scripts/run-tests.mjs`（vitest 2,226 通過。落ちた 5 と node:test の落ちた 2 は、浅い clone で履歴とタグを見る試験。履歴を全部取ってから走らせ直して、vitest の heldout 6 通過・node:test 237 通過 0 落ち）。足した vitest：app-update-switch 3・connect-https 2・human-guide 5。CI は PR で見る。
- 画面で動いた：CI の ubuntu・windows の Chrome で、connect-maximo.spec（設定 → つなぎ先を足す → 読む → 確定 → 差分 → 送る）と、受け入れの 2 つ目（入れた版の橋渡しの設定の画面）が通った。手元では走らせていない（橋渡しを 127.0.0.1 に起こすため）。
- Claude Code で端から端まで通った：未確認。
- Windows の実機で動いた：未確認（CI の windows の仕事では通った。実機ではない）。
- Excel で開いて見やすかった：関係なし。

受け入れの 1 つ目（setup で入れる）は手元の Linux で走らせた：版のフォルダ・印・Claude Desktop の設定・送信者の名前までは通り、最後の「連携の部品が版のフォルダに入っている」で落ちた。
このセッションの網は部品の取り先（codeload.github.com）を 403 で止めるので、版のフォルダの `npm ci` が任意の依存を**黙って飛ばした**。運営者の PC で起きたのと同じ形を、この試験が止めることを確かめた（CI は取り先に届くので通る見込み。未確認）。

## CI に足した時間（cfa3908 で測った）

- 新しい仕事 `install`：windows 5 分 49 秒・ubuntu 1 分 8 秒（ほかの仕事と並んで走るので、全体の時間はほぼ伸びない。いちばん長いのは e2e と test の windows）。
- e2e の仕事：connect-maximo.spec 1 本が windows 23.1 秒（e2e の 55 件は 10.4 分）。仕事の全体は windows 13 分 18 秒・ubuntu 12 分 48 秒。
- test の仕事：connect-https の 3 件（数秒）。

## CI の結果（cfa3908）

- 緑：install（windows・ubuntu）・e2e（windows・ubuntu。55 件すべて。connect-maximo も通った）・test（windows）・pack-bench・scenario。
- 赤：test（ubuntu）の「Skill の文の採点の記録」の段だけ（試験はすべて通った）。main（a61f032）でも同じ 2 つの指紋で落ちる。この PR は skills/・packs/・eval/ を変えていない。直すには今の文の採点の記録（2 つのパック × 解く役 2 つ）が要る。どこで置くかは統括に任せる（PR にも書いた）。
- 途中で CI が見つけて直したもの：つなぎ先 0 の一覧の表は高さ 0（見えない扱い）・Playwright の読み込みが src/plan/store の JSON の import を読めず e2e が全部走らなかった・偽の Maximo から読んだ資料で既定の答えの無い質問・偽の Maximo の HTTPS の包みが本体を Buffer で渡して書き込みが断られた（connect-https に、包みを通して送るまでの試験を足した）。

## 見直し（別の役が差分だけを読んだ）

CI を落とす誤りは無し。e2e の数（足す・変える・送った数）は src の数え方と合う、とのこと。直したもの：
- macOS では、部品の SecretBox が利用者のキーチェーンの項目（"MX Stage"）に鍵を置き、一時の HOME では分けられない → connect-https と connect-maximo.spec は macOS で走らせない（CI に macOS は無い）。
- connect-https は、CI で部品の /testing が無ければ落とす（黙って飛ばさない）。
- 受け入れの 2 つ目：入れた橋渡しの自動の確かめ（起動の 60 秒あと）が本物の mushitaro/moyai を取りに行かないよう、一時の設定で「最新の確かめ」を切る。
- app-update-switch：用意の待ちを 60 秒にし、終わらなければその旨で落とす。
- connect-https の 2 つ目：落ちた理由が通信の誤り（MaximoNetworkError）で、偽の Maximo に HTTP の要求が 1 つも届いていない（TLS の握手で断った）ことを見る。
- human-guide：一時の抜けは 10 から増やせない。
- 直さなかったもの：一時の抜けの「書いたら移す」は、決めた語に合う文にしか効かない（語は困りごとの PR と #146 で文に合わせる）。

## 守ったこと

- 127.0.0.1 への HTTP：偽の Maximo（試験の中だけ。橋渡しが送る）と、今の e2e の道具（画面・中継）だけ。手元で橋渡しに送っていない。
- 本物の Claude Desktop の設定・本物の状態フォルダ・利用者の `~/.config/mxstage` を読まない・書かない（どの試験も一時のフォルダ）。本物の受け口・本物の Maximo・本物の GitHub に送らない。
- 人だけの操作・断る試験は変えていない。src/ は変えていない。

## 使用量の残り

- 測っていない。API のキーを使う仕事はしていない。

## 次の一手

1. test（ubuntu）の採点の記録の段を緑にする（main と同じ原因。統括が置き場所を決める）。
2. 困りごとの PR が入ったら、`PENDING` の `app_feedback_send` を GUIDE に移す（その PR で）。
3. #146：9 つの案内を 1 段目の Skill に書き、採点の記録と一緒に入れる。
4. PR #143（確定のあと MOYAI のトップに戻る）が先に入ると、connect-maximo.spec の「確定 → 連携のシート」の段も、connect.spec と同じ直しが要る。
