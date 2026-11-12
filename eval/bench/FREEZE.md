# 新しいサンプルの凍結の測り（mushitaro/moyai#111）

A1・A1b・A3（`docs/scenarios.md` の S-A）は、運営者が承認した新しいサンプル（`samples/waste-incineration-v3`）を、凍結した読み手で測った記録だけで決めます。

旧サンプル（`samples/waste-incineration`）の記録（`eval/bench/waste-incineration/`）は「旧」として残します。合否には使いません。

形は見ていない様式（`samples/heldout/README.md`・`tests/heldout/heldout.test.ts`）と同じです。

## 順

1. **読み手を凍結する。** `--samples` の入った main の commit に、タグ `reader-freeze-7` を打ちます。
   - タグを打って push するのは統括か運営者です。
   - このときサンプルはまだリポジトリにありません。
2. **確かめる。** `node scripts/bench/freeze.mjs check --samples samples/waste-incineration-v3 --tag reader-freeze-7`
   - サンプルを入れる前に走らせると、「サンプルの置き場所が無い」で止まります。中身を入れたあとに走らせます。
   - 確かめること：タグがある・タグの木にサンプルが無い・タグの pack-bench が `--samples` を持つ・凍結の測りがまだ無い。
3. **新しいサンプルを入れる。** 運営者が承認した 11 施設を、タグより後のコミットで `samples/waste-incineration-v3/` に入れます。
   - 入れる人も、AI も、中身を読みません。読み手を直す手がかりにしないためです。
4. **タグの worktree で 1 回だけ測る。** `node scripts/bench/freeze.mjs measure --samples samples/waste-incineration-v3 --tag reader-freeze-7`
   - タグを一時の worktree に取り出し、その中の pack-bench で 2 つを測ります：Skillパックありと、初めて読む（`--first-read`）。
   - 測った読み手の `src/`・`packs/` の木がタグと違えば止まります。
   - `frozen/` がもうあれば止まります。測りは 1 回だけです。
5. **記録する。** 書いたものを 1 つのコミットで入れます。
   - `eval/bench/waste-incineration-v3/frozen/`：`freeze.json`（タグ・読み手の木・サンプルのハッシュ）、`result.json`、`first-read/result.json`。書き直しません。
   - 今の記録：`eval/bench/waste-incineration-v3/result.json` と `first-read/result.json`。始まりは凍結の値と同じです。

## そのあと

- CI の `pack-bench` の仕事は、`frozen/freeze.json` があるときだけ新しいサンプルを測ります。今の記録と `--strict` で比べます。
- `scenario` の仕事は、A1・A1b・A3 をこの結果だけで決めます。
- 凍結の記録が無いあいだは、A1・A1b・A3 は「待ち（#111）」です。根拠の字に旧サンプルの値を添えます。
- 読み手を直して数が変わったら、今の記録だけを測り直します：`node scripts/bench/pack-bench.mjs waste-incineration --samples samples/waste-incineration-v3`（`--first-read` も）。`frozen/` は最初の測りとして残ります。
- 毎回確かめること（`tests/heldout/bench-freeze.test.ts`）：
  - タグの木にサンプルが無い。
  - 順が「タグ → サンプルのコミット → 凍結の記録のコミット」になっている。
  - サンプルのハッシュが凍結のときと同じ。
  - 凍結の結果を測った読み手の木がタグと同じ。
