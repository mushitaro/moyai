import { test } from "node:test";
import assert from "node:assert/strict";
import { planDiff, costUsd, renderMarkdown, AuditResult } from "../../scripts/audit/lib.mjs";

const fileDiff = (name, body = "+x\n") => `diff --git a/${name} b/${name}\nindex 1..2 100644\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1 @@\n${body}`;

test("差分をファイルごとに分け、生成物とバイナリは理由つきで外す", () => {
  const d = fileDiff("src/a.ts") + fileDiff("package-lock.json") + fileDiff("samples/out/x.csv") + fileDiff("docs/x.pdf");
  const r = planDiff(d);
  assert.deepEqual(r.included.map((p) => p.file), ["src/a.ts"]);
  assert.equal(r.skipped.length, 3);
  assert.ok(r.skipped.every((s) => s.reason.length > 0));
});

test("上限を越えた差分は黙って捨てず、見ていない差分として返す", () => {
  const big = "+" + "a".repeat(200) + "\n";
  const d = fileDiff("src/a.ts", big) + fileDiff("src/b.ts", big);
  const r = planDiff(d, 300);
  assert.equal(r.included.length, 1);
  assert.equal(r.skipped[0].file, "src/b.ts");
  assert.match(r.skipped[0].reason, /見ていない/);
});

test("費用はトークンの種類ごとの値段で出す", () => {
  const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
  const c = costUsd({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 0 }, price);
  assert.equal(Number(c.toFixed(4)), 4 + 2 + 0.4);
});

test("結果の型は重さを 3 つに閉じる", () => {
  const ok = AuditResult.safeParse({ summary: "s", findings: [{ severity: "major", file: "a", line: 1, rule: "r", problem: "p", fix: "f" }], unchecked: [] });
  assert.equal(ok.success, true);
  const bad = AuditResult.safeParse({ summary: "s", findings: [{ severity: "info", file: "a", line: 1, rule: "r", problem: "p", fix: "f" }], unchecked: [] });
  assert.equal(bad.success, false);
});

test("結果があるときも、要約にモデルの識別子を書かない", () => {
  const result = { summary: "要約", findings: [{ severity: "minor", file: "a.ts", line: 3, rule: "AGENTS.md", problem: "p", fix: "f" }], unchecked: ["u"] };
  const md = renderMarkdown({ role: "audit", base: "a".repeat(40), head: "b".repeat(40), result, skipped: [], usage: { input_tokens: 1 }, cost: 0.1, stopReason: "end_turn" });
  assert.doesNotMatch(md, /claude-|opus|sonnet|haiku|fable/i);
  assert.match(md, /指摘 1 件/);
});

test("値段が分からないときは費用を $0 と書かない", () => {
  const md = renderMarkdown({ role: "audit", base: "a".repeat(40), head: "b".repeat(40), result: null, skipped: [], usage: { input_tokens: 1 }, cost: null, stopReason: "x" });
  assert.match(md, /計れない/);
  assert.doesNotMatch(md, /\$0\.0000/);
});

test("要約にはモデルの識別子を書かず、受け取れなかったときはそう書く", () => {
  const md = renderMarkdown({ role: "audit", base: "a".repeat(40), head: "b".repeat(40), result: null, skipped: [], usage: {}, cost: 0, stopReason: "refusal" });
  assert.match(md, /受け取れませんでした/);
  assert.doesNotMatch(md, /claude-|opus|sonnet/i);
});
