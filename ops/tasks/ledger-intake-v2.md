---
id: ledger-intake-v2
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 25
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 公開台帳の取り下げの印（retired.json）を、台帳の検証と受け口で受ける

ledger-intake-v1（MOYAI 経由で公開台帳へ出す受け口）の続き。取り下げの形は Architect が決めた（台帳 `.cache/review/ledger.md` の 72。下に写す）。

先に読む：`AGENTS.md`、`docs/plan.md` §2.19（引退の印）、`docs/security.md`、`src/share/ledger.ts`（`verifyLedgerFiles`）、`src/share/ring.ts`（`readRing` と `moyai.retired/0`）、`services/ledger-intake/`（v1 の受け口）、`src/app/text/`（SHARE の下の帯の字）。

台帳のリポジトリは `mushitaro/moyai-ledger` のまま（運営者の決定、11-07）。受け口の `LEDGER_REPO` の既定はこれにする。PR を出すのは、運営者が受け口に入れるトークンのアカウント（画面の字は「tsunagi（MOYAI の運営）」）。

決まり（Architect の 72）：
1. 形：`ledger/bundles/<鍵ID>/retired.json`。型は輪と同じ `moyai.retired/0` で、ring の代わりに ledger（台帳 ID）を持つ：`{ ledger, key, pub, last, month }`。次の鍵は書かない。
2. 本人の確かめ：その鍵自身の署名で、道の鍵 ID・本文の key・pub から作った鍵 ID の 3 つが同じときだけ受ける（readRing と同じ）。
3. 載ったあと：ファイルは消さず、印を足す。`verifyLedgerFiles` と集計は、印のある鍵を k にも集計にも数えない。last より大きい連番の束は ✗（afterRetired）。k が下限を割った塊は今の決まりどおり帯を出さない。
4. 道：GitHub の道は利用者の PR で retired.json を出す（CLI の `ledger submit` で出せれば足りる。画面の取り下げのボタンはこの仕事ではしない）。MOYAI 経由は同じファイルを受け口の `POST /submit` に送る（束と同じ口・同じ IP の上限）。受け口は、その鍵の束の PR がまだマージされていなければ、その PR を閉じて「本人が取り下げた」と書き、取り下げの PR は出さない。マージ済みなら取り下げの PR を出す。
5. 受け口の PR はどれも tsunagi のアカウントなので、「GitHub のアカウントが替わった印」を MOYAI 経由の束には付けない。

するもの：
- `verifyLedgerFiles` に 1〜3 を入れる。試験で縛る：自分の署名の印で外れる・他人の鍵の署名の印は ✗・印のあとの束は ✗・k の数が減る。
- 受け口に 4 と 5 を入れる（v1 の試験の形で、GitHub への fetch を差し替えて試す。マージ前なら PR を閉じる・マージ後なら取り下げの PR）。
- 取り下げを約束しない字にする（画面の取り下げのボタンが入るまで）：GitHub の道の下の帯から「取り下げても」を外す（「GitHub に PR を送信。掲載後の複製は残ります。」）。MOYAI 経由は「MOYAI 経由で PR を送信。掲載後の複製は残ります。」。`docs/words.md` の字と合わせる。
- `docs/security.md` の「保証できないこと」に「公開台帳に載せた束は、今は画面から取り下げられない（印の形は決めた）」を足す。

- **SHARE の画面を Wire の決めた形に**（`docs/screens.md` §3.6「送信経路」、`docs/words.md`）：v1 は字を仮に置いた（「GitHub アカウントなしで送信」など）。出す先の右の行を「送信経路　GitHub［名］ | MOYAI 経由」の切り替えにし（既定は GitHub につないでいれば GitHub［名］、いなければ MOYAI 経由。施設ごとに覚える）、「PR の GitHub アカウント　［名］」の 1 行（MOYAI 経由なら「tsunagi（MOYAI の運営）」）、MOYAI 経由のときだけ経路の行の下に text-3 で「送信元の IP は上限の判定のみ・保存なし」、主ボタン「署名して公開台帳へ送信」、断られたとき 3 つ（受付不可・送信の上限・受け口の応答なし）を §3.6 のとおりに。

触らないもの：`src/import/`、`src/app/intake/`、`packs/`、束の形と署名の字（retired の型は輪と同じ形を使う）。

済んだと言える条件：verify が通る。report.md に、変えた所、試験の数、未確認のこと（本物の GitHub と Cloudflare）を書く。
