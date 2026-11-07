---
id: intake-screen-v4
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 150
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 取り込みの画面：Wire の写しの照らし 5 つと、止まった知らせの写し

Wire が 34cb0bd の写しを照らし、直す所を `docs/screens.md` §3.3 の末尾「写しの照らし」に書いた。その 5 つを直し、止まった知らせを e2e で撮る。

先に読む：`AGENTS.md`、`docs/screens.md` §1・§3.3（末尾の「写しの照らし」）、`docs/words.md`、`src/app/pages/Intake.tsx`（`SourceTab`・`cellInfo`・`CellAnswers`・`StopNotices`）、`src/app/pages/Merge.tsx`（見出し・下の帯・横の板）、`src/app/theme.css` か `src/app/intake/intake.css`（未確定のセルの見た目）、`tests/e2e/intake.spec.ts`、`tests/helpers/e2e.ts`（`shot`）。

1. **見出し**：第 1 版をつくる前は、施設の名前だけ。「第 1 版」の札を出さない。つくったあとは今のとおり「第 1 版　編集中」。
2. **未確定のセル**：四方の朱の枠をやめ、朱の字（`var(--shu-text)`）と、セルの下の 2px の朱の線（`box-shadow: inset 0 -2px 0 var(--shu)`）だけにする。枠は選んだセルの印として残す。
3. **未確定のセルの詳しく**：「未解決。この質問に答えると決まります：…」の文をやめる。種別「未確定」（朱。凡例と同じ言葉）の下に「質問　{その質問の題}」と「| 決める」。押すと横の板の「未回答」でその質問を開く。質問が分からないセル（questionId が null）は「質問」の行を出さない。
4. **答えのセルの詳しく**：1 行目「答え　{答えの字}」、2 行目「{作者}　{日時}」と右端に「| 取り消す」（折り返さない。nowrap）。
5. **「| 資料を重ねて第 n 版をつくる」**：つくった版に入っていない変更（資料の追加・答えの変更・取り消し）があるときだけ出す。置き場所は凡例の行の右端（凡例の上に 1 行の空きを作らない）。つくった直後は出さない。
6. **止まった知らせの写し**：e2e（`tests/e2e/` に足す）で 2 つの状態を作り、写しを撮る（`shot()`、名前は `intake-stop-unknown-${tag}`・`intake-stop-worker-${tag}`）。
   - 結果不明：橋渡しの擬似の返事を時間切れにする（試験の橋渡しか、ページの中の差し替えで。本物の橋渡しの時間の上限は変えない）。下の帯の左に「結果不明 1」が出て、押すと横の板の詳しくに記録（処理・日時・停止箇所）。
   - 取り込み停止：取り込みの処理（worker）を止める（試験の口から terminate するか、応答しない worker に差し替える）。「取り込み停止」が出て、押すと詳しく。
   - 試験の口を足すなら、本番の画面からは届かない形にする（例：試験のビルドだけ、か `window.__moyaiTest` が無いと何もしない）。
7. 字は `src/app/text/index.ts`。言葉は `docs/words.md`。

試験：vitest で 1〜5、e2e で 6 と、今の `tests/e2e/intake.spec.ts` を新しい形に合わせる（playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く。Dev が実機で回す）。

触らないもの：`src/import/`（別の仕事 intake-many-v1 が触る）、`src/cli/`、`packs/`、署名される字。Claude に返す字は変えない。

済んだと言える条件：verify が通る。report.md に、変えた所、試験の数、e2e の段の名前、未確認のことを書く。
