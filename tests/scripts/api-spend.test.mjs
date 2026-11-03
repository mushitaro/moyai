import { test } from "node:test";
import assert from "node:assert/strict";
import { readLedger, totals, budgetCheck } from "../../scripts/api-spend.mjs";

const budget = { stopAt: 400, f3: 60, audit: 40, dev: 300, reserve: 100 };
const rows = (pairs) => pairs.map(([role, usd]) => ({ role, usd }));

test("台帳の壊れた行は捨てずに数える", () => {
  const r = readLedger('{"role":"audit","usd":1}\nnot json\n{"role":"dev"}\n\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.broken, 2);
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
