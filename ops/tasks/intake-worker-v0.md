---
id: intake-worker-v0
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 45
timeoutMin: 240
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 取り込みを Web Worker へ移す（200 ファイルで止まらない）

いまの困りごと（測った値）：資料を 31 個（Excel 1・CSV 12・PDF 18）入れると、AI のツールを呼ぶたびに作業画面が 11〜15 秒止まる。未解決は 121,768 セル、質問は 2,214 問。読み・分析（`IntakeSession.add`・`analyze`・`settle`・`compose`・`survey`）が画面の主のスレッドで走っているため。運営者の頼みは「200 ファイルくらいでも、止まらずに処理する」。

先に読む：`AGENTS.md`、`docs/plan.md` §2.12、`src/app/intake/workspace.ts`（取り込みの作業場。画面とツールの受け手 `tab-tools.ts` が同じ 1 つを使う）、`src/import/session.ts`（`IntakeSession`）、`src/app/intake/tab-tools.ts`、`vite.config.ts`。

1. **境目**：`IntakeSession` を Web Worker（`src/app/intake/intake.worker.ts`、vite の `new Worker(new URL(...), { type: "module" })`）の中に置く。主のスレッドの `workspace.ts` は、今と同じ公開の形（試験が使う形）を保ち、中で worker に頼む。メッセージは構造化複製できる値だけにする（型を `src/app/intake/worker-protocol.ts` に 1 つ）。
   - 画面が同期で読んでいる所（質問の一覧・件数・要約）は、worker から返った最新の写しを主のスレッドに持ち、変わったら知らせる（今の購読の形に合わせる）。
   - worker が使えない所（vitest の node）は、同じ protocol を同じスレッドで処理する受け手に切り替える。試験は今のまま通ること。
2. **まとめて読む・進みを出す**：落とされた資料は 1 つずつ worker に送り、読み終わるごとに進みを返す。画面の下の帯に「読込 37/200」の形で出す（字は `src/app/text/index.ts` に足す。言葉は `docs/words.md` に従う）。読みの途中でも、画面とツールは止まらない。分析（analyze）は、読みが全部終わってから 1 回、または読みの途中は最後の要求だけ（間を詰める）。
3. **資料ごとの覚え**：同じ名前・同じ大きさ・同じ中身のハッシュの資料は、読み直さない（worker の中の Map。タブを閉じれば消えてよい）。
4. **ツールの答えの速さ**：`tab-tools.ts` の受け手は、worker の答えを await する。分析の途中に呼ばれたら、終わるのを待ってから答える（古い値を返さない）。ハブの呼び出しの時間の上限は今のまま。
5. **試験**：
   - vitest：protocol の往復（同じスレッドの受け手で）、進みの数、同じ資料を 2 回入れても 1 回しか読まない、分析の要求を詰める。
   - 速さ：`tests/perf/` に、工場の架空の資料を 200 個に増やして入れ、主のスレッドの 1 回の仕事が 200 ms を越えないことを測る試験を足す（node で測れる範囲で。測った値は report.md に書く）。
   - 既存の試験（unit・node・contract）を全部通す。playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く。

触らないもの：`src/import/` の読み手の中身（別の仕事が直している。worker に置くために要る小さな変更だけはよいが、report.md に全部書く）、`src/shared/tools.ts`、`src/cli/`、署名される字（basis の文・LEDGER_SOURCE・CONVERSATION_SOURCE・cond・toItem/toAttr）、`packs/`。

済んだと言える条件：verify が通る。report.md に、境目（どの呼び出しを worker に置いたか）、進みの出し方、測った値、未確認のこと（実機のブラウザで 200 個を入れること）を書く。
