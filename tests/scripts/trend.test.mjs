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

test("③ に余分な記録の数を出し、物差しの行に試験の結果を添える（形は dev.test.ts の TrendRecord）", () => {
  const rec = { pack: "p", facility: "f", files: [{ file: "a.xlsx", leak: 0, unresolved: 0, accuracy: { correct: 10, total: 10, extra: 2 } }], asked: 1, planMade: true, cross: { correct: 3, total: 4 } };
  const md = render([{ date: "2026-11-04", time: "09:00", commit: "c", dirty: false, passed: true, counts: { node: 1, vitest: 1 }, import: [rec] }]);
  assert.match(md, /\| 2026-11-04 \| 通った \| f \| a\.xlsx \| 0 \| 0 \| 100%（10\/10、余分 2） \|/);
  assert.match(md, /75%（3\/4）/);
});

test("⑥ 取り戻せた割合と、そのうちの工数・日数を出す。無い回は「測っていない」", () => {
  const base = { pack: "p", files: [], asked: 1, planMade: true, cross: null };
  const md = render([
    {
      date: "2026-11-04",
      time: "09:00",
      commit: "c",
      dirty: false,
      passed: true,
      counts: { node: 1, vitest: 1 },
      import: [
        { ...base, facility: "f1", recovery: { together: 9, denominator: 10, manDays: { correct: 4, total: 4 }, days: { correct: 1, total: 2 }, starOnly: 10 } },
        { ...base, facility: "f2" },
      ],
    },
  ]);
  assert.match(md, /\| f1 \| 1 \| 作った \| 測っていない \| 90%（9\/10） \| 100%（4\/4） \| 50%（1\/2） \|/);
  assert.match(md, /\| f2 \| 1 \| 作った \| 測っていない \| 測っていない \| 測っていない \| 測っていない \|/);
});

test("見ていない様式：組ごとに 1 回測った値を、計画が無ければ ③ を「測れない」として出す。無ければ「まだ測っていない」", () => {
  const day = { date: "2026-11-04", time: "09:00", commit: "c", dirty: false, passed: true, counts: { node: 1, vitest: 1 }, import: [] };
  assert.match(render([day]), /## 見ていない様式[^\n]*\n\nまだ測っていない。/);
  const h = {
    set: "heldout-1",
    measuredAt: "2026-11-03T22:16:10.655Z",
    reader: { tag: "reader-freeze-1", commit: "0d5405b72ef0", src: "s", packs: "p" },
    result: {
      files: [
        { file: "a.csv", format: "csv", leak: 0, unresolved: 546, accuracy: null, rejected: null },
        { file: "p.jpg", format: "jpg", leak: null, unresolved: null, accuracy: null, rejected: "読んでいない（写真は AI が読む）" },
      ],
      asked: 24,
      answered: 9,
      openAtEnd: new Array(15).fill({}),
      planMade: false,
      blockers: ["未解決のセル 1428"],
      recovery: { together: 0, denominator: 142, manDays: { correct: 0, total: 60 }, days: { correct: 0, total: 73 } },
    },
  };
  const md = render([day], [h]);
  assert.match(md, /\| heldout-1 \| reader-freeze-1 \| 2026-11-04 07:16 \| a\.csv \| csv \| 0 \| 546 \| 計画なし（測れない） \|/);
  assert.match(md, /\| heldout-1 \| reader-freeze-1 \| 2026-11-04 07:16 \| p\.jpg \| jpg \| 読んでいない \| — \| — \|/);
  assert.match(md, /\| heldout-1 \| 24（9・15） \| 作らなかった（未解決のセル 1428） \| 0%（0\/142） \|/);
});
