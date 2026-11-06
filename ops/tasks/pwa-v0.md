---
id: pwa-v0
role: dev-core
agent: dev-core
environment: env-kinds
budgetUsd: 20
timeoutMin: 180
verify: ["npm ci --ignore-scripts", "npm run typecheck", "node scripts/run-tests.mjs", "node scripts/check-publish.mjs", "npm run build"]
---
# 作業画面を PWA にし、閉じる前に知らせ、作業中の計画を戻せるようにする

困りごと：利用者が間違えてブラウザを閉じると、作業中のもの（資料・答え・作業中の計画）が消える。作業画面はタブのメモリだけに持っている。運営者は最初から PWA の想定だった。

先に読む：`AGENTS.md`、`docs/plan.md` §2.12、`vite.config.ts`、`src/app/main.tsx`（か入口）、`src/app/state/plan-store.ts`（作業中の計画の置き場）、`src/app/state/decisions.ts`、`src/bridge/server.ts`（dist/app を出す所。127.0.0.1 で出す）。

1. **PWA**：`src/app/public/manifest.webmanifest`（名前は MOYAI、`display: standalone`、`start_url: "/"`、アイコンは今の favicon から 192・512 の PNG を作るか、既にあるものを使う）と、Service Worker（手書きの小さなもの、`src/app/public/sw.js`）。SW は画面の殻（index.html・JS・CSS・書体）だけを覚える。`/api` やツールの道は覚えない・横取りしない。版が変わったら古い覚えを捨てる（ビルドの印 `__MOYAI_BUILD__` を名前に入れる）。橋渡しのサーバーが manifest と sw.js を正しい content-type で出すことを確かめる（要れば server.ts の型の表に足す）。
2. **閉じる前の知らせ**：作業中のもの（資料が 1 つ以上ある・未確定の答えか計画がある）があるときだけ `beforeunload` で知らせる。確定と出力が済んで何も無いときは知らせない。
3. **作業中の計画を戻す**：`plan-store.ts` の作業中の計画と、確定のシートの受けた・受けていない（`decisions.ts`）を、変わるたびに IndexedDB に書く（間を 1 秒詰める）。開いたときに残っていれば、下の帯に「前の作業を戻す｜捨てる」を出し、人が選ぶ。施設と版が違えば戻さない。確定・署名したら消す。資料そのもの（取り込みの作業場、`src/app/intake/`）は、この仕事では戻さない（別の仕事が Web Worker へ移しているので触らない）。
4. 字は `src/app/text/index.ts` に足す。言葉は `docs/words.md` に従う（○・● は「星取」。印・束・輪・決定のシートは使わない。確定のシート）。
5. **試験**：vitest（fake-indexeddb が無ければ、保存の口を差し替えて試す）で、書く・戻す・施設が違えば戻さない・確定で消す・beforeunload の条件。SW の試験は、覚える道と覚えない道の判定の関数を分けて単体で試す。playwright はサンドボックスで走らないので、走らせられなかったと report.md に書く。

触らないもの：`src/import/`、`src/app/intake/`、`src/shared/tools.ts`、`src/cli/`、署名される字、`packs/`。

済んだと言える条件：verify が通る。report.md に、覚える道、戻すときの画面の字、試験の数、未確認のこと（実機の Edge でインストールと閉じて開くこと）を書く。
