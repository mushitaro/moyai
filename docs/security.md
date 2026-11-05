# MOYAI の守り

このファイルは `src/shared/security.ts` が、ツール定義と経路の許可の一覧から作ります。手で直さないでください（`MOYAI_WRITE_DOCS=1 npx vitest run tests/contract/security-doc.test.ts` で作り直します）。

決めるのは人です。確定・送る・昇格・保存は、AI のツールにありません。AI クライアントが使えるのは下の表のツールだけで、人だけの操作は作業画面のボタンと、端末の人だけのコマンドにあります。

例外は 2 つです（MCP の instructions の安全の決まり 1 と同じ）。どちらも、承認は人の署名です。

1. 引き渡しのメールを送ること。人が MERGE で「署名して渡す」を押すと、`intake_survey` の handoff に MOYAI が用意したメールの文（宛先・件名・本文）が入ります。利用者が送ってと言ったら、Claude が利用者の連携したメールから、その文のまま送ります。中身は版の場所とハッシュと、リンクの中の使い捨ての合言葉（受け取りに使う）です。合言葉は、文を読んだ AI の提供者にも渡ります。受け取れるのは最初の 1 回だけです。計画の中身は運びません。MOYAI にメールを送るツールはありません。
2. 未承認の読み方の下書きを保管先に書くこと（`reading_skill_register`）。保管先の決まった場所に、未承認の 3 段目の Skill として書きます。承認は、その読み方を使った版への人の署名です。

## AI に渡る範囲（ツールごと）

AI クライアント（Claude Code・Claude Desktop）は、標準入出力の MCP の中継（`moyai mcp`）からこのツールを呼びます。結果は AI クライアントに渡り、その先の AI の提供者にも渡ります。

| ツール | 種類 | 今 | 渡るもの・置くもの | 待ちの上限 |
|---|---|---|---|---|
| `intake_survey` | 読む | 動く | 作業画面に入れた資料の要約、行番号つきの見本、凡例、注記、質問の候補、詰まっている所（stuck：資料ごとの未解決のセルの数とその行の見本。 | 20 秒、1 回だけ送り直す |
| `intake_settle` | 案を置く | 動く | 質問への決定を置く。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `intake_compose` | 始める | 動く | 決定がそろったら、元の計画を作り始める。 | 20 秒、送り直さない（来なければ「結果不明」） |
| `photo_transcribe` | 案を置く | 動く | 人が画面で許した写真を 1 枚受け取る（receive）か、読んだ格子を置く（place）。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `crosswalk_propose` | 案を置く | 動く | 資産の節を共通の設備項目の 1 段目に（set.field は assetNode.commonItem、値は intake_survey の crosswalk.items のコード）、作業を作業の属性に（set.field は work.attribute、値は INSPECT・OVERHAUL・REPLACE・UPGRADE）当てる規則を案として置く。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `chart_rows` | 読む | 動く | 星取表の行の一部を読む。 | 20 秒、1 回だけ送り直す |
| `chart_propose` | 案を置く | 動く | 規則で、星取表に周期の案を置く（足すだけ。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `check_results` | 読む | 動く | 作業中の計画に、パックの検査を、作業画面の基準日で走らせた結果を読む（読むだけ。 | 20 秒、1 回だけ送り直す |
| `note_for_human` | 案を置く | 未実装 | 確定・昇格・送るの前に人に見てほしいことをメモに置く。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `share_preview` | 読む | 未実装 | 共有の束に写す数、写さなかった理由ごとの数、k の段を読む。 | 20 秒、1 回だけ送り直す |
| `peer_reference` | 読む | 動く | 似た施設との比べから、下限を守った集計と匿名の札だけを読む。 | 20 秒、1 回だけ送り直す |
| `skill_eval` | 始める | まだ見せない | Skill の版の一覧と表の要約を読む（list）か、評価を走らせる（run）。 | 20 秒、送り直さない（来なければ「結果不明」） |
| `reading_rules_propose` | 案を置く | 動く | 取り込みを詰めきれないとき、利用者と会話で決めた読み方の規則を、作業中の版の下書きの読み方（3 段目の Skill）に置く。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `reading_skill_register` | 案を置く | 動く | 作業中の版の下書きの読み方（reading_rules_propose で置いたもの）を、保管先の決まった場所に、未承認の 3 段目の Skill（SKILL.md と rules.json）として書く。 | 30 秒、送り直さない（来なければ「結果不明」） |
| `reading_skills_list` | 読む | 動く | 保管先にある 3 段目の Skill（読み方）の一覧。 | 20 秒、1 回だけ送り直す |

## 上限

- 星取表の行は、1 回 200 行まで、会話（中継の 1 つの接続）で 2,000 行まで。数えるのは橋渡しで、タブを読み込み直しても数は戻りません。
- 要約の欄ごとの多い値は 20 まで、文字は 60 字まで。行の参照の例は 10 件まで。
- 資料は 1 ファイル 64 MB まで（作業画面のタブのメモリに読みます）。
- 写真は、人が作業画面で 1 枚ずつ許したものだけを、1 回に 1 枚渡します。作業画面が長辺 1,568〜2,000 px・JPEG で約 100 KB 以下に描き直し（切り抜かず、位置などの付け足しの情報は落とす）、橋渡しは、許した画像のハッシュと合うものだけを渡します（300 KB を越えるものは渡しません）。許しは 1 回渡すと使い終わります。
- 外へ出た台帳：橋渡しは、AI に返した結果ごとに、ツールの名前・大きさ（バイト）・行の数・添えた画像の大きさを、橋渡しのメモリに新しい 2,000 行まで持ち、会話ごとの合計も持ちます。返した中身は持ちません。ファイルには書かず、橋渡しを止めると消えます（画面に出すのは未実装）。

## 人だけの操作（AI のツールに無い）

次の経路は、タブの秘密（作業画面のタブが作り、HTML にもどの GET にも入れない）と、1 回きりの印（操作と中身のハッシュに結び、120 秒で切れ、1 回使うと消える）の両方を求めます。一覧に無い経路は断ります。

| 経路 | 操作 | 説明 |
|---|---|---|
| `POST /human/commit-trial` | `commit_trial` | 確定の試しの経路（v0。中身は何もしない。守りの形を試験するためのもの） |
| `POST /human/plan-status` | `plan_status` | 確定した版の一覧と、いちばん新しい版（確定のダイアログを開いたとき） |
| `POST /human/plan-commit` | `plan_commit` | 計画を確定する（自分の鍵で版に署名し、版のファイルと署名を足し、差分レポートと人が見る様式の星取表の Excel を書く） |
| `POST /human/plan-revert` | `plan_revert` | 前の版に戻す（前の版を指す記録を足し、自分の鍵で署名する） |
| `POST /human/plans-list` | `plans_list` | 保管先の施設と版の一覧（版の番号・時刻・署名の役目・確かめの結果・編集の番）を、トップのもやいの星取表に読む |
| `POST /human/comment-add` | `comment_add` | 計画にコメントを足す（星取表の行と、この PC の呼び名を添えて、保管先に置く。署名はしない） |
| `POST /human/comments-list` | `comments_list` | 計画のコメントを古い順に読む（MERGE の横の板の「コメント」） |
| `POST /human/plan-version-read` | `plan_version_read` | 確かめで合う版の計画を 1 つ読む（トップの版の印のメニュー：開く・この版から次の版・この版から別の施設をつくる） |
| `POST /human/plan-sign` | `plan_sign` | いちばん新しい版に、自分の鍵で承認か差し戻しの署名を足し、編集の番を替える（頼みを受け取った鍵だけ） |
| `POST /human/request-receive` | `request_receive` | メールのリンクの使い捨ての合言葉を頼みと照らし、自分の鍵で受け取りに署名して置く（最初の 1 つだけ） |
| `POST /human/request-renew` | `request_renew` | 頼み直す：新しい頼みに署名して置き、前のリンクを使えなくする。渡すメールの文を用意する |
| `POST /human/plan-file-read` | `plan_file_read` | 確定した版の Excel（人が見る様式の星取表か差分レポート）を読んで、画面がブラウザに落とす |
| `POST /human/plan-source-put` | `plan_source_put` | 次の版に重ねるため、版を組んだ資料を 1 つ、保存先の計画のフォルダに中身のアドレス（SHA-256）で置く（確定では SHA-256 だけを送る） |
| `POST /human/plan-source-read` | `plan_source_read` | 確かめで合う版を組んだ資料を 1 つ読む（版の記録の SHA-256 と照らす。次の版に重ねるため、画面に戻す） |
| `POST /human/templates-read` | `templates_read` | 保存先の様式と写し方（列の役目）の一覧と、承認済みか下書きか、その版で書き出したか |
| `POST /human/template-save` | `template_save` | 利用者が落とした様式と、直した写し方（列の役目）を、保存先に下書きとして置く |
| `POST /human/export-sign` | `export_sign` | いちばん新しい版を保存先の様式で書き出し、書き出した Excel に自分の鍵で署名して版に足す（版の中身は変えない。その写し方の承認になる） |
| `POST /human/export-file-read` | `export_file_read` | 署名した書き出しの Excel を読み、署名のハッシュと照らしてから、画面がブラウザに落とす |
| `POST /human/person-key-create` | `person_key_create` | 自分の鍵（版に署名する）を作り、状態フォルダに置く |
| `POST /human/person-key-confirm` | `person_key_confirm` | ほかの人の鍵を、指紋を読み合わせて確認済みにする（それまでの署名では読み方を承認しない） |
| `POST /human/settings-read` | `settings_read` | 置き場所・Documents の場所・輪の一覧を読む |
| `POST /human/settings-save` | `settings_save` | 置き場所・公開の台帳の clone の場所・自分の呼び名を保存する |
| `POST /human/ring-create` | `ring_create` | 輪を作り、その輪の鍵の対を状態フォルダに置く |
| `POST /human/checkpoint-preview` | `checkpoint_preview` | 検問所：出ていく束のバイト列とハッシュと数（送る処理と同じ関数） |
| `POST /human/checkpoint-open-text` | `checkpoint_open_text` | 検問所：出ていく束を同期されない一時フォルダに写し、OS のテキストエディタで開く |
| `POST /human/checkpoint-send` | `checkpoint_send` | 検問所：署名し、束を輪のフォルダに置く |
| `POST /human/ring-verify` | `ring_verify` | 輪を受け手と同じ関数で確かめる |
| `POST /human/ring-member-confirm` | `ring_member_confirm` | 輪の仲間の鍵を、指紋を読み合わせて確認済みにする（確認済みの仲間の束だけを数える） |
| `POST /human/ring-rules-accept` | `ring_rules_accept` | 変わった輪の決まり（circle.json）を受け入れる（受け入れるまで送らない。緩くした決まりは受け入れない） |
| `POST /human/ledger-preview` | `ledger_preview` | 公開の台帳へ出す束のバイト列とハッシュと数（輪と同じ関数。行き先は台帳の clone の決まり） |
| `POST /human/ledger-send` | `ledger_send` | 束に署名し、台帳の clone に足したときに受け手と同じ関数で ✓ になるかを確かめてから、GitHub で台帳をフォークして束 1 つの PR を出す（通信の例外。行き先は github.com と api.github.com だけ） |
| `POST /human/ledger-rules-accept` | `ledger_rules_accept` | 変わった公開の台帳の決まりを、人が差を見て受け入れる（見た決まりのハッシュと同じで、緩くした決まりでないときだけ） |
| `POST /human/ledger-prs` | `ledger_prs` | 出した束の PR の行方（審査中・台帳の検証・載った・差し戻しの理由）を、公開の PR からトークン無しで読む（SHARE を開いたときだけ） |
| `POST /human/github-connect-start` | `github_connect_start` | GitHub につなぐ：OAuth のデバイスフローを始める（人が github.com でコードを入れる。scope は public_repo だけ）。台帳に束を出す施設の鍵は、送ったときに保管先の計画のフォルダに書く |
| `POST /human/github-connect-state` | `github_connect_state` | GitHub につなぐ途中の様子（待っている・つながった・断られた・時間切れ）。つながったら、トークンを状態フォルダに置く（包まない。見張りのフックが AI の読み取りを止める） |
| `POST /human/github-disconnect` | `github_disconnect` | GitHub との接続を切る（状態フォルダのトークンのファイルを消す） |
| `POST /human/readings-read` | `readings_read` | 保管先の承認済みの読み方（3 段目の Skill）を、作業画面に読み込む |
| `POST /human/peers-compare` | `peers_compare` | 受け手：立場ごとに、台帳の clone と自分の輪の ✓ の束から、似た施設の行と統計の行を作る |
| `POST /human/photo-allow` | `photo_allow` | 写真を 1 枚、AI クライアントに渡すことを許す（渡す画像のハッシュに結ぶ。1 回渡すと使い終わる） |

人だけの操作の名前は 39 個です。ツールの名前と重ならないことを試験で確かめています。

## 網の外側

- 橋渡しは 127.0.0.1 の 1 つのポートだけで待ち受け、Host・Origin・Sec-Fetch-Site を確かめます。これは Web ページからの呼び出しへの守りで、同じ PC の同じ利用者のプロセスは止めきれません（curl も Node も Origin を偽れます）。
- 中継と橋渡しの間は、状態フォルダの鍵ファイル（利用者だけが読める既定の権限）で確かめます。同じ利用者のプロセスには読めます。
- シェルを持つ AI（Claude Code）には、リポジトリの `.claude/settings.json` の deny と PreToolUse のフック（`scripts/guard-hook.mjs`）の二重で、127.0.0.1 への HTTP・状態フォルダの読み取り・保管先の計画のフォルダの施設の署名鍵（share/keys/）の読み書き・輪のフォルダへの書き込み・人だけのコマンドを止めます。悪意のある同じ利用者のプロセスは止めきれません。
- 鍵と GitHub のトークンは合言葉で包みません（運営者の決定 2026-11-04）。人の鍵とトークンは同期されない状態フォルダに、束に署名する施設の鍵は保管先の計画のフォルダ（share/keys/）に置きます。MCP のどのツールの結果にも、鍵とトークンの中身は入れません。
- 人だけのコマンド（鍵を作る、送る、台帳に出す）は、標準入力が端末でなければ断ります。
- MOYAI は AI の提供者の API のキーを受け取りません（チャットでもツールでも、`src/` のどのコードでも読みません）。API のキーを使う Skill の採点（F3）は未実装です。

## 保証できないこと

1. 1 回の上限は、繰り返し呼べば越えられます（だから会話の合計に上限を置き、外へ出た台帳で会話ごとの合計を数えます。合計は橋渡しを止めると消えます）。
2. チャットに Excel を添付すれば、ファイル全体が AI の提供者に渡ります。
3. ファイルを読める AI は、確定した計画のファイルを直接読めます。
4. Documents が同期フォルダ（OneDrive など）の下なら、確定した計画は会社のクラウドに上がります（だから最初に調べて知らせます）。
5. 「外へは送らない」はアプリの通信の話で、データの行き先の保証ではありません。
6. 写真とスキャンの読み取りでは、人が許したその画像が AI の提供者に渡ります。
7. 画面を操作できる AI の道具（ブラウザやデスクトップの操作）は、人だけのボタンを押せます。
8. 計画のフォルダを読める人と AI は、施設の署名鍵を写せます（写した人は、その施設として束を出せます）。保管先が同期フォルダなら、施設の署名鍵も会社のクラウドに上がります。
