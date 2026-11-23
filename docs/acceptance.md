# 受け入れの試験（docs/plan.md §5.1）

`node scripts/acceptance.mjs`（または `node scripts/trend.mjs`）が、試験の実行の報告から作ります。手で直さないでください。試験の名前と試験のファイルの対応は `tests/acceptance-map.json` の 1 か所で、名前の並びと合格の条件は `docs/plan.md` §5.1 の表です。

結果は 5 つです：通った（対応する試験が §5.1 の合格の条件まで確かめ、すべて通った）／一部（範囲の注を見る。対応する試験は通ったが、合格の条件の一部しか確かめていない）／落ちた（1 つでも落ちた）／試験が無い（対応する試験を作っていない）／測っていない（試験はあるが、この実行で走っていない）。

- 作った時刻：2026-11-24 03:39 JST・コミット `ce5882e`・OS linux
- 報告：node:test 238・vitest 2243・Playwright 56
- 通った 18・一部 10・落ちた 0・試験が無い 0・測っていない 1（全 29）

| 試験の名前 | 結果 | 通った・落ちた | 対応する試験 | 範囲の注 |
|---|---|---|---|---|
| `import.dev` | 一部（範囲の注を見る） | 3・0 | `tests/unit/import/dev.test.ts`：通った 2・落ちた 0<br>`tests/unit/import/photo-measure.test.ts`：通った 1・落ちた 0 | 写真の ③ と要確認の数は測った値を出す試験（photo-measure）。目標に届いたかの値は docs/trend.md |
| `import.heldout` | 一部（範囲の注を見る） | 6・0（飛ばした 1） | `tests/heldout/heldout.test.ts`：通った 6・落ちた 0・飛ばした 1 | いつも走るのは、凍結 → ハッシュ → 公開の順と、測った読み手の確かめだけ。② 0・③ 100% に届いたかは試験で見ていない（測った値は docs/trend.md） |
| `layer1.*` | 通った | 29・0 | `tests/unit/import/layer1.test.ts`：通った 13・落ちた 0<br>`tests/unit/import/pdf.test.ts`：通った 16・落ちた 0 |  |
| `crosswalk.*` | 通った | 10・0 | `tests/unit/crosswalk/crosswalk.test.ts`：通った 10・落ちた 0 |  |
| `cross-layer` | 一部（範囲の注を見る） | 2・0 | `tests/unit/cross/next-due.test.ts`：通った 2・落ちた 0 | 取り込み（周期の列と ●）→ 計画 → 星取表の行の次回 → Excel の次回の列。暦のきっかけだけ（取り込みは計量値の欄をまだ読まない。運転時間との早い方は tests/unit/plan-next.test.ts と plan-due-view.test.ts の計画の側だけ） |
| `counts` | 一部（範囲の注を見る） | 3・0 | `tests/unit/import/layer2-4.test.ts`（「層 4」）：通った 1・落ちた 0<br>`tests/unit/import/dev.test.ts`：通った 2・落ちた 0 | 入れた行＝取り込んだ数＋外した数（理由ごと）＋未解決を、数え直しの関数（layer2-4）と開発用の資料の全ファイル（dev）で見る。保存したあとの数（版のファイルに数は残していない）は見ていない |
| `pack.second` | 通った | 3・0 | `tests/packs/pack-second.test.mjs`：通った 2・落ちた 0<br>`tests/unit/packs/night-soil-slice.test.ts`：通った 1・落ちた 0 |  |
| `pack.words` | 一部（範囲の注を見る） | 5・0 | `tests/unit/review/tool.test.ts`（「業種の語」）：通った 1・落ちた 0<br>`tests/unit/packs/pack-words-src.test.ts`：通った 4・落ちた 0 | src/ の全部のファイルを、common.json のあるパック（今はごみ焼却・し尿処理。ほかの空のパックには語が無い）の語で見る。ただし、コメントの中の語（例の字）と、試験の台だけで使う偽の連携（src/bridge/connect/fake.ts、【架空】の中身）は数えない |
| `pack.map` | 一部（範囲の注を見る） | 10・0 | `tests/unit/packs/pack-map.test.tsx`：通った 9・落ちた 0<br>`tests/e2e/industries.spec.ts`：通った 1・落ちた 0 | 全部の空のパックのスキーマと、画面に全行が並ぶことは見る。選んだときの「中身が無い」1 行と出どころの候補は、最初の空のパック 1 つで見る（ほかは、候補があることを形で見る） |
| `kinds` | 通った | 14・0 | `tests/packs/kinds.test.mjs`：通った 6・落ちた 0<br>`tests/packs/night-soil.test.mjs`：通った 8・落ちた 0 |  |
| `checks` | 通った | 38・0 | `tests/unit/review/checks.test.ts`：通った 35・落ちた 0<br>`tests/unit/review/measure.test.ts`：通った 3・落ちた 0 |  |
| `trigger.property` | 一部（範囲の注を見る） | 14・0 | `tests/property/trigger.test.ts`：通った 14・落ちた 0 | 計算の関数だけ。取り込んだ実績から次回を出すところは cross-layer。計量値の欄の取り込みは、まだ無い |
| `human-only` | 通った | 391・0 | `tests/unit/human-only.test.ts`：通った 36・落ちた 0<br>`tests/unit/human-routes.test.ts`：通った 355・落ちた 0 |  |
| `hook` | 通った | 95・0 | `tests/scripts/guard-hook.test.mjs`：通った 95・落ちた 0 |  |
| `reserved-names` | 通った | 2・0 | `tests/scripts/reserved-names.test.mjs`：通った 2・落ちた 0 |  |
| `contract` | 通った | 102・0 | `tests/contract/contract.test.ts`：通った 102・落ちた 0 |  |
| `share.leak` | 通った | 5・0 | `tests/unit/share/leak.test.ts`：通った 5・落ちた 0 |  |
| `share.k` | 通った | 17・0 | `tests/unit/share/k.test.ts`：通った 17・落ちた 0 |  |
| `share.stable` | 通った | 5・0 | `tests/unit/share/copyout.test.ts`（「share.stable」）：通った 5・落ちた 0 |  |
| `share.grain` | 通った | 10・0 | `tests/unit/share/copyout.test.ts`（「share.grain」）：通った 10・落ちた 0 |  |
| `share.tamper` | 通った | 20・0 | `tests/unit/share/tamper.test.ts`：通った 20・落ちた 0 |  |
| `share.rules` | 通った | 9・0 | `tests/unit/share/rules.test.ts`：通った 9・落ちた 0 |  |
| `share.chart` | 通った | 32・0 | `tests/unit/share/aggregate.test.ts`：通った 10・落ちた 0<br>`tests/unit/share/receive.test.ts`：通った 10・落ちた 0<br>`tests/unit/share/site.test.ts`：通った 12・落ちた 0 |  |
| `verify demo-ring` | 通った | 13・0 | `tests/unit/share/demo-ring.test.ts`：通った 13・落ちた 0 |  |
| `ledger` | 一部（範囲の注を見る） | 56・0（飛ばした 2） | `tests/unit/share/ledger.test.ts`：通った 30・落ちた 0<br>`tests/unit/share/prdiff.test.ts`：通った 17・落ちた 0・飛ばした 2<br>`tests/unit/share/ledger-demo.test.ts`：通った 7・落ちた 0<br>`tests/e2e/ledger-site.spec.ts`：通った 2・落ちた 0 | 台帳のリポジトリの Actions は、ここでは走らせていない（同じ判定の CLI validate-pr を一時の git のリポジトリで試す） |
| `e2e.daily` | 一部（範囲の注を見る） | 2・0 | `tests/e2e/slice.spec.ts`：通った 1・落ちた 0<br>`tests/e2e/review.spec.ts`：通った 1・落ちた 0 | 「毎日通る」は 1 回の実行では言えない。この表は 1 回の実行の結果 |
| `windows` | 測っていない | 0・0 | `tests/e2e/slice.spec.ts`：この実行の OS（linux）では数えない（win32 で測る）<br>`tests/e2e/template.spec.ts`：この実行の OS（linux）では数えない（win32 で測る）<br>`tests/unit/places.test.ts`（「Documents と同期フォルダ」）：この実行の OS（linux）では数えない（win32 で測る）<br>`tests/unit/human-only.test.ts`（「使われているポート」）：この実行の OS（linux）では数えない（win32 で測る） | Windows の実行（win32）でだけ数える。ほかの OS の実行では測っていない。起動・ツール・確定は slice、書き出しは template、OneDrive に移された日本語の Documents は places（PowerShell の出力を差し替える）、使われているポートは human-only。日本語のフォルダの道で e2e は走らせていない。「毎日通る」は 1 回の実行では言えない。CI の acceptance（windows-latest）の仕事が、Windows の報告からこの表を作る（仕事の要約と成果物 acceptance-windows。リポジトリのこの表は手元の実行） |
| `eval` | 一部（範囲の注を見る） | 10・0 | `scripts/skill-scores/check.mjs`：当たり 0（終了コード 0）<br>`tests/scripts/skill-scores-check.test.mjs`：通った 9・落ちた 0 | 運営者の判断（mushitaro/moyai#23 の 2、2026-11-12）で、API で 1 問 3 回解いて点と費用を比べる形をやめ、正解を見ない別々の解く役 2 つが解いてコードで採点する形にした。見るのは、今の文の採点の記録があり、文と問題の組の指紋が今と合い、2 つ以上の役の合格の数がそろうこと（main より下がっていないかは CI の --base で見る。この表の実行では比べない） |
| `publish` | 通った | 10・0 | `scripts/check-publish.mjs`：当たり 0（終了コード 0）<br>`scripts/check-deps.mjs`：当たり 0（終了コード 0）<br>`tests/scripts/check-publish.test.mjs`：通った 5・落ちた 0<br>`tests/scripts/check-deps.test.mjs`：通った 3・落ちた 0 |  |

試験が無い名前：無し。
