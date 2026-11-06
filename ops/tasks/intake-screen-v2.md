---
id: intake-screen-v2
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 資料のシートの詳しくに答えの取り消しを、下の帯に止まった知らせを置く

前の仕事 intake-screen-v1 で、決定の一覧と AI の作業の記録を画面から消した。その代わりの置き場を Wire が決めた（`docs/screens.md` §3.3 の末尾の「答えの取り消し」「止まった知らせ」の 2 行と、§3.2「資料のタブに置かないもの」）。

先に読む：`AGENTS.md`、`docs/screens.md` §3.2・§3.3、`docs/words.md`、`src/app/pages/Intake.tsx`（`SourceTab`・`cellInfo`）、`src/app/pages/Merge.tsx`（横の板の詳しく・下の帯）、`src/app/intake/workspace.ts`（`undoAsync(questionId)`・`notices`。読むだけで、変えない）、`src/app/text/index.ts`。

1. **答えの取り消し**：資料のシートで、答えで決まったセルを選ぶと、横の板の詳しくに 1 行「答え　{答えの字}　{作者}　{日時 YYYY-MM-DD HH:MM}」と「| 取り消す」。作者は画面の字（人・会話の回答・Claude 判断。`src/app/text/index.ts` の今の字を使う）。押すと `ws.undoAsync(questionId)` を呼び、その質問は未回答に戻る（同じ答えで決まったセルもまとめて戻る）。戻ったら、横の板の未回答の数と下の帯の押せない理由が増えることを確かめる。確定のシートには人の答えを並べない。
2. **止まった知らせ**：`ws.notices` のうち、AI の作業の結果が分からないもの（結果不明）と、取り込みの処理の停止（workerStopped・workerFallback）だけを、下の帯の左（編集者の右）に朱の字で「結果不明 n」「取り込み停止」と出す。ふつうに終わった作業は出さない。押すと横の板の詳しくに、その記録（何を・いつ・止まった所）と、やり直せるものなら「| やり直す」。やり直しの口が今の workspace に無ければ、「| やり直す」は出さず report.md に書く。
3. 版があるとき（「資料を重ねて第 n 版をつくる」）も同じ形にする（押せない理由「理由：未回答 n」、知らせの箱なし）。v1 で済んでいれば確かめるだけ。
4. 言葉は `docs/words.md` に従う。`tests/contract/old-words.test.ts` を通す。
5. **試験**：vitest で、答えたセルを選ぶと詳しくに答えの行と取り消すが出る・押すと未回答が 1 増える・結果不明の記録があると下の帯に「結果不明 1」・ふつうの記録だけなら何も出ない・押すと詳しくに記録。`tests/e2e/intake.spec.ts` に、答えて取り消して答え直すと押せる段を戻す（playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く）。

触らないもの：`src/import/`、`src/app/intake/`（workspace・worker・intake-host）、`src/shared/tools.ts`、`src/cli/`、署名される字、`packs/`。Claude に返す字は変えない。

済んだと言える条件：verify が通る。report.md に、変えた部品、足した字、試験の数、未確認のことを書く。
