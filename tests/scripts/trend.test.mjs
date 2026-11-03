// scripts/trend.mjs：数の読み方と、落ちた回・測っていない値の書き方。
import { test } from "node:test";
import assert from "node:assert/strict";
import { jst, parseCounts, render } from "../../scripts/trend.mjs";

test("run-tests の最後の行から数を読む。無ければ null", () => {
  assert.deepEqual(parseCounts("…\nrun-tests: node:test 131 件、vitest 241 件\n"), { node: 131, vitest: 241 });
  assert.equal(parseCounts("落ちた"), null);
});

test("JST の日付は 15:00 UTC で次の日になる", () => {
  assert.deepEqual(jst(new Date("2026-11-03T15:00:00Z")), { date: "2026-11-04", time: "00:00" });
});

test("日ごとに最後の行を出し、落ちた回は「落ちた」、無い値は「測っていない」と書く", () => {
  const md = render([
    { date: "2026-11-03", time: "10:00", commit: "a", dirty: false, passed: true, counts: { node: 1, vitest: 2 }, import: [] },
    { date: "2026-11-03", time: "18:00", commit: "b", dirty: false, passed: false, counts: null, import: [{ facility: "f", files: [{ file: "x.csv", leak: null, unresolved: 0, accuracy: null }], asked: 3, planMade: false, cross: null }] },
  ]);
  assert.match(md, /\| 2026-11-03 \| 18:00 \| `b` \| 測っていない \| 測っていない \| 落ちた \|/);
  assert.doesNotMatch(md, /10:00/);
  assert.match(md, /\| x\.csv \| 測っていない \| 0 \| 測っていない \|/);
  assert.match(md, /作らなかった/);
});
