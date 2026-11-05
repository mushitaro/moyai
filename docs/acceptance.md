# 受け入れの試験（docs/plan.md §5.1）

`node scripts/acceptance.mjs`（または `node scripts/trend.mjs`）が、試験の実行の報告から作ります。手で直さないでください。試験の名前と試験のファイルの対応は `tests/acceptance-map.json` の 1 か所で、名前の並びと合格の条件は `docs/plan.md` §5.1 の表です。

結果は 5 つです：通った（対応する試験が §5.1 の合格の条件まで確かめ、すべて通った）／一部（範囲の注を見る。対応する試験は通ったが、合格の条件の一部しか確かめていない）／落ちた（1 つでも落ちた）／試験が無い（対応する試験を作っていない）／測っていない（試験はあるが、この実行で走っていない）。

- 作った時刻：2026-11-05 12:34 JST・コミット `e437dec`
- 報告：node:test 159・vitest 921・Playwright 渡していない（測っていない）
- 通った 18・一部 3・落ちた 0・試験が無い 6・測っていない 2（全 29）

| 試験の名前 | 結果 | 通った・落ちた | 対応する試験 | 範囲の注 |
|---|---|---|---|---|
| `import.dev` | 一部（範囲の注を見る） | 3・0 | `tests/unit/import/dev.test.ts`：通った 2・落ちた 0<br>`tests/unit/import/photo-measure.test.ts`：通った 1・落ちた 0 | 写真の ③ と要確認の数は測った値を出す試験（photo-measure）。目標に届いたかの値は docs/trend.md |
| `import.heldout` | 一部（範囲の注を見る） | 4・0（飛ばした 1） | `tests/heldout/heldout.test.ts`：通った 4・落ちた 0・飛ばした 1 | いつも走るのは、凍結 → ハッシュ → 公開の順と、測った読み手の確かめだけ。② 0・③ 100% に届いたかは試験で見ていない（測った値は docs/trend.md） |
| `layer1.*` | 通った | 29・0 | `tests/unit/import/layer1.test.ts`：通った 13・落ちた 0<br>`tests/unit/import/pdf.test.ts`：通った 16・落ちた 0 |  |
| `crosswalk.*` | 通った | 10・0 | `tests/unit/crosswalk/crosswalk.test.ts`：通った 10・落ちた 0 |  |
| `cross-layer` | 試験が無い | — | — | tests/unit/cross/import-share.test.ts は取り込み → 写し取りの層をまたぐ試験で、きっかけの次回とは別のもの |
| `counts` | 試験が無い | — | — |  |
| `pack.second` | 通った | 3・0 | `tests/packs/pack-second.test.mjs`：通った 2・落ちた 0<br>`tests/unit/packs/night-soil-slice.test.ts`：通った 1・落ちた 0 |  |
| `pack.words` | 一部（範囲の注を見る） | 1・0 | `tests/unit/review/tool.test.ts`（「業種の語」）：通った 1・落ちた 0 | 見ているのは検査のコードと画面の言葉だけで、src/ 全体ではない |
| `pack.map` | 試験が無い | — | — |  |
| `kinds` | 通った | 14・0 | `tests/packs/kinds.test.mjs`：通った 6・落ちた 0<br>`tests/packs/night-soil.test.mjs`：通った 8・落ちた 0 |  |
| `checks` | 通った | 38・0 | `tests/unit/review/checks.test.ts`：通った 35・落ちた 0<br>`tests/unit/review/measure.test.ts`：通った 3・落ちた 0 |  |
| `trigger.property` | 試験が無い | — | — |  |
| `human-only` | 通った | 279・0 | `tests/unit/human-only.test.ts`：通った 30・落ちた 0<br>`tests/unit/human-routes.test.ts`：通った 249・落ちた 0 |  |
| `hook` | 通った | 82・0 | `tests/scripts/guard-hook.test.mjs`：通った 82・落ちた 0 |  |
| `reserved-names` | 通った | 2・0 | `tests/scripts/reserved-names.test.mjs`：通った 2・落ちた 0 |  |
| `contract` | 通った | 71・0 | `tests/contract/contract.test.ts`：通った 71・落ちた 0 |  |
| `share.leak` | 通った | 5・0 | `tests/unit/share/leak.test.ts`：通った 5・落ちた 0 |  |
| `share.k` | 通った | 17・0 | `tests/unit/share/k.test.ts`：通った 17・落ちた 0 |  |
| `share.stable` | 通った | 5・0 | `tests/unit/share/copyout.test.ts`（「share.stable」）：通った 5・落ちた 0 |  |
| `share.grain` | 通った | 10・0 | `tests/unit/share/copyout.test.ts`（「share.grain」）：通った 10・落ちた 0 |  |
| `share.tamper` | 通った | 20・0 | `tests/unit/share/tamper.test.ts`：通った 20・落ちた 0 |  |
| `share.rules` | 通った | 9・0 | `tests/unit/share/rules.test.ts`：通った 9・落ちた 0 |  |
| `share.chart` | 通った | 30・0 | `tests/unit/share/aggregate.test.ts`：通った 10・落ちた 0<br>`tests/unit/share/receive.test.ts`：通った 10・落ちた 0<br>`tests/unit/share/site.test.ts`：通った 10・落ちた 0 |  |
| `verify demo-ring` | 通った | 12・0 | `tests/unit/share/demo-ring.test.ts`：通った 12・落ちた 0 |  |
| `ledger` | 測っていない | 50・0 | `tests/unit/share/ledger.test.ts`：通った 27・落ちた 0<br>`tests/unit/share/prdiff.test.ts`：通った 16・落ちた 0<br>`tests/unit/share/ledger-demo.test.ts`：通った 7・落ちた 0<br>`tests/e2e/ledger-site.spec.ts`：報告が無い | 台帳のリポジトリの Actions は、ここでは走らせていない（同じ判定の CLI validate-pr を一時の git のリポジトリで試す） |
| `e2e.daily` | 測っていない | 0・0 | `tests/e2e/slice.spec.ts`：報告が無い<br>`tests/e2e/review.spec.ts`：報告が無い | 「毎日通る」は 1 回の実行では言えない。この表は 1 回の実行の結果 |
| `windows` | 試験が無い | — | — | CI（.github/workflows/ci.yml）は windows-latest でも試験の全体を走らせるが、§5.1 の起動・ツール 1 つ・確定・書き出し・日本語の道・OneDrive の Documents・使われているポートを通す試験は無い |
| `eval` | 試験が無い | — | — |  |
| `publish` | 通った | 9・0 | `scripts/check-publish.mjs`：当たり 0（終了コード 0）<br>`scripts/check-deps.mjs`：当たり 0（終了コード 0）<br>`tests/scripts/check-publish.test.mjs`：通った 4・落ちた 0<br>`tests/scripts/check-deps.test.mjs`：通った 3・落ちた 0 |  |

試験が無い名前：`cross-layer`・`counts`・`pack.map`・`trigger.property`・`windows`・`eval`。
