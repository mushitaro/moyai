# 新しいサンプルの凍結の測り（mushitaro/moyai#111）

A1・A1b・A3（`docs/scenarios.md` の S-A）は、運営者が承認した新しいサンプル v4 を、凍結した読み手で測った記録だけで決めます。

- 旧サンプル（`samples/waste-incineration`）：運営者が不合格にした（ファイルの形がほぼ同じ）。記録（`eval/bench/waste-incineration/`）は「旧」として残し、合否には使いません。
- v3：運営者が不合格にした。測っていません。
- v4：11 施設・2,565 ファイル・約 440 MB。MOYAI 本体には入れず、別の公開リポジトリ `mushitaro/moyai-samples` の `waste-incineration-v4/` に置きます（運営者の判断、11-14）。

形は見ていない様式（`samples/heldout/README.md`・`tests/heldout/heldout.test.ts`）と同じです。違うのは、サンプルがこのリポジトリの木に入らないことです。そこで「タグの木にサンプルが無い」を確かめる代わりに、サンプルのリポジトリの commit（40 字）と束のハッシュを記録します。

## 順

1. **読み手を凍結する。** タグは `reader-freeze-7`（c73c815）。このまま変えません。
2. **サンプルのリポジトリを取る。** `mushitaro/moyai-samples` を clone し、運営者が承認した commit にします。
   - サンプルの中身は、測る人も AI も読みません。読み手を直す手がかりにしないためです。
3. **確かめる。** `node scripts/bench/freeze.mjs check --samples <clone>/waste-incineration-v4 --tag reader-freeze-7`
   - 確かめること：タグがある・タグの pack-bench が `--samples` を持つ・凍結の測りがまだ無い・サンプルが git のリポジトリの中にあり、commit していない変更が無い。
4. **タグの worktree で 1 回だけ測る。** `node scripts/bench/freeze.mjs measure --samples <clone>/waste-incineration-v4 --tag reader-freeze-7`
   - タグを一時の worktree に取り出し、その中の pack-bench で 2 つを測ります：Skillパックありと、初めて読む（`--first-read`）。
   - 測った読み手の `src/`・`packs/` の木がタグと違えば止まります。
   - 測っているあいだにサンプルの commit か中身が替われば止まります。
   - `frozen/` がもうあれば止まります。測りは 1 回だけです。
   - 時間：手元で数時間かかる見込みです（今の 49 ファイルで、パックあり 2 分余り・初めて読む 5 分足らず。2,565 ファイルではその 10〜50 倍）。
   - 測る場所：クラウドのセッションか M-PC3。CI では測りません。
5. **記録する。** 書いたものを 1 つのコミットで入れます。
   - `eval/bench/waste-incineration-v4/frozen/`：`freeze.json`、`result.json`、`first-read/result.json`。書き直しません。
     - `freeze.json` に書くもの：タグ・読み手の木・束のハッシュと、`source`（サンプルのリポジトリの URL〔鍵は除く〕・commit・中の道）。
   - 今の記録：`eval/bench/waste-incineration-v4/result.json` と `first-read/result.json`。始まりは凍結の値と同じです。

## そのあと

- CI の `pack-bench` の仕事は、`frozen/freeze.json` があるときだけ、`mushitaro/moyai-samples` を記録した commit で取ります。2,565 ファイルの全部は 20 分に収まらないので、全部は測りません。測るのは次の 2 つだけです。
  - (a) 凍結の記録の照らし（`tests/heldout/bench-freeze.test.ts`）：読み手の木がタグと同じ・サンプルの clone が記録した commit・束のハッシュが同じ。
  - (b) 資料の少ない 3 施設を今のコードで測り、今の記録の同じ施設の行と `--strict` で比べる（`scripts/bench/v4-ci.mjs`）。
- `scenario` の仕事は、A1・A1b・A3 を、今の記録と (a)(b) の結果で決めます。合否は今の記録で決め、根拠の字に凍結の回（最初の 1 回）の値を添えます。
- 凍結の記録が無いあいだ（`mushitaro/moyai-samples` がまだ無いときも）は、A1・A1b・A3 は「待ち（#111）」です。根拠の字に旧サンプルの値を添えます。
- 読み手を直して数が変わったら、手元で全部を測り直し、今の記録だけを入れ直します。
  - `node scripts/bench/pack-bench.mjs waste-incineration --samples <clone>/waste-incineration-v4`（`--first-read` も）。既定の置き場所は `eval/bench/waste-incineration-v4/`。
  - `frozen/` は、最初の測りとして残ります。
- 手元の `npm run scenario` で (b) を見るときは、`MOYAI_SAMPLES_ROOT=<clone>` を付けます。
- 通しの試験：`tests/scripts/bench-freeze-external.test.mjs`。偽の小さなサンプルのリポジトリ（一時の git）と、一時の clone で走らせます。
  - `MOYAI_FREEZE_FULL=1` なら measure まで通します（CI の `pack-bench` の仕事）。
