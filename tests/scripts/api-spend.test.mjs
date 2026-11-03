import { test } from "node:test";
import assert from "node:assert/strict";
import { readLedger, totals, budgetCheck, syncedRunIds, pendingCiEstimate } from "../../scripts/api-spend.mjs";

const budget = { stopAt: 400, f3: 60, audit: 40, dev: 300, reserve: 100 };
const rows = (pairs) => pairs.map(([role, usd]) => ({ role, usd }));

test("台帳の壊れた行は捨てずに数え、費用を計れなかった回は別に数える", () => {
  const r = readLedger('{"role":"audit","usd":1}\nnot json\n{"role":"dev"}\n{"role":"audit","usd":null}\n\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.broken, 2);
  assert.equal(r.unknown, 1);
});

test("読めない行か費用を計れなかった回があれば、呼ぶ前に止める", () => {
  assert.equal(budgetCheck(budget, [], "audit", 0, { broken: 0, unknown: 1 }).stop, true);
  assert.equal(budgetCheck(budget, [], "audit", 0, { broken: 1, unknown: 0 }).stop, true);
});

test("打ち消しの行（負の費用）も合計に入る", () => {
  assert.equal(totals(rows([["audit", 0.8], ["audit", -0.8]])).all, 0);
});

test("CI の回のうち、台帳に写していないものだけを見込みに数える（いまの回は数えない）", () => {
  const synced = syncedRunIds('{"role":"audit","usd":0,"runId":"1"}\n{"role":"audit","usd":0.5,"runId":"2"}\n');
  const p = pendingCiEstimate([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], synced, 4, 2);
  assert.deepEqual(p, { count: 1, usd: 2 });
});

test("役ごとと全体の合計", () => {
  const t = totals(rows([["audit", 1], ["dev", 2], ["audit", 0.5]]));
  assert.deepEqual(t, { byRole: { audit: 1.5, dev: 2 }, all: 3.5 });
});

test("配分の内なら止めない", () => {
  assert.equal(budgetCheck(budget, rows([["audit", 10]]), "audit", 2).stop, false);
});

test("役の配分に届くなら呼ぶ前に止める", () => {
  const r = budgetCheck(budget, rows([["audit", 39]]), "audit", 2);
  assert.equal(r.stop, true);
  assert.match(r.reason, /audit/);
});

test("dev-core と factory は dev の配分から使う", () => {
  const r = budgetCheck(budget, rows([["dev", 200], ["dev-core", 90]]), "factory", 15);
  assert.equal(r.stop, true);
});

test("全体が止める額に届くなら止める", () => {
  const r = budgetCheck(budget, rows([["dev", 299], ["f3", 59], ["audit", 39]]), "audit", 5);
  assert.equal(r.stop, true);
  assert.match(r.reason, /止める額/);
});
