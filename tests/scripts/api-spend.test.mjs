import { test } from "node:test";
import assert from "node:assert/strict";
import { readLedger, totals, budgetCheck, syncedRunIds, pendingCiEstimate, runKeys, ledgerRowForAttempt } from "../../scripts/api-spend.mjs";

const budget = { stopAt: 400, f3: 60, audit: 40, dev: 300, reserve: 100 };
const rows = (pairs) => pairs.map(([role, usd]) => ({ role, usd }));

test("台帳の壊れた行は捨てずに数え、費用を計れなかった回は別に数える", () => {
  const r = readLedger('{"role":"audit","usd":1}\nnot json\n{"role":"dev"}\n{"role":"audit","usd":null}\n\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.broken, 2);
  assert.equal(r.unknown, 1);
});

test("計れなかった回は、人が確かめた解決の行（resolves）があれば数えない", () => {
  const text =
    '{"role":"audit","runKey":"5-1","usd":null}\n' +
    '{"role":"audit","runKey":"6-1","usd":null}\n' +
    '{"role":"audit","usd":0.3,"resolves":"5-1"}\n';
  const r = readLedger(text);
  assert.equal(r.unknown, 1);
  assert.equal(totals(r.rows).all, 0.3);
});

test("読めない行か費用を計れなかった回があれば、呼ぶ前に止める", () => {
  assert.equal(budgetCheck(budget, [], "audit", 0, { broken: 0, unknown: 1 }).stop, true);
  assert.equal(budgetCheck(budget, [], "audit", 0, { broken: 1, unknown: 0 }).stop, true);
});

test("打ち消しの行（負の費用）も合計に入る", () => {
  assert.equal(totals(rows([["audit", 0.8], ["audit", -0.8]])).all, 0);
});

test("CI の試みのうち、台帳に写していないものだけを見込みに数える（いまの試みは数えない）", () => {
  const synced = syncedRunIds('{"role":"audit","usd":0,"runId":"1"}\n{"role":"audit","usd":0.5,"runKey":"2-1"}\n');
  const p = pendingCiEstimate([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], synced, "4-1", 2);
  assert.deepEqual(p, { count: 1, usd: 2 });
});

test("再実行した回は、試みの数だけ数える", () => {
  assert.deepEqual(runKeys({ id: 9, run_attempt: 3 }), ["9-1", "9-2", "9-3"]);
  assert.deepEqual(pendingCiEstimate([{ id: 9, run_attempt: 2 }], new Set(["9-2"]), null, 2), { count: 1, usd: 2 });
});

const at = { key: "7-1", createdAt: "2026-11-03T05:00:00Z" };
test("写す判定：記録が無ければ費用は計れない（$0 にしない）", () => {
  assert.equal(ledgerRowForAttempt(at, null).usd, null);
});
test("写す判定：別の試みの記録なら計れない", () => {
  assert.equal(ledgerRowForAttempt(at, { runKey: "6-1", costUsd: 1 }).usd, null);
});
test("写す判定：呼んでいない記録なら $0（理由つき）", () => {
  const r = ledgerRowForAttempt(at, { runKey: "7-1", called: false, reason: "no-key" });
  assert.equal(r.usd, 0);
  assert.match(r.note, /no-key/);
});
test("写す判定：費用があればそれを、使ったトークンがあって費用が無ければ計れない", () => {
  assert.equal(ledgerRowForAttempt(at, { runKey: "7-1", costUsd: 0.4, usage: { input_tokens: 1 } }).usd, 0.4);
  assert.equal(ledgerRowForAttempt(at, { runKey: "7-1", costUsd: null, usage: { input_tokens: 1 } }).usd, null);
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

test("呼ばなかった回（artifact の名前が audit-result-uncalled）は見込みで $0、数には入れる（台帳の CI-1b）", async () => {
  const { pendingCiEstimate, uncalledByArtifacts } = await import("../../scripts/api-spend.mjs");
  const runs = [{ id: 1, run_attempt: 1 }, { id: 2, run_attempt: 1, uncalled: true }, { id: 3, run_attempt: 2 }];
  const r = pendingCiEstimate(runs, new Set(["3-1"]), null, 2);
  assert.equal(r.count, 3);
  assert.equal(r.usd, 4);
  assert.equal(uncalledByArtifacts(["audit-result-uncalled"]), true);
  assert.equal(uncalledByArtifacts(["audit-result-called"]), false);
  assert.equal(uncalledByArtifacts([]), false);
});
