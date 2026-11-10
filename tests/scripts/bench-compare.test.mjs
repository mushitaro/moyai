// 物差しの比べ（scripts/bench/compare.mjs）：判定は数だけで決まる
import test from "node:test";
import assert from "node:assert/strict";
import { compare, toMarkdown } from "../../scripts/bench/compare.mjs";

const row = (facility, over = {}) => ({ facility, planMade: true, recovery: { correct: 10, total: 20 }, accuracy: { correct: 5, total: 5 }, manDays: null, days: null, unresolvedAfter: 0, open: 0, asked: 3, error: null, ...over });
const res = (facilities, pack = "p") => ({ schema: "moyai.pack-bench.result/0", pack, reader: { commit: "abcdef0123" }, facilities });

test("どの数も同じなら「差なし」", () => {
  const c = compare(res([row("a")]), res([row("a")]));
  assert.equal(c.verdict, "差なし");
  assert.equal(c.changed, false);
});

test("⑥ が増えれば「良くなった」、質問の数だけの違いは判定に使わない", () => {
  assert.equal(compare(res([row("a")]), res([row("a", { recovery: { correct: 11, total: 20 } })])).verdict, "良くなった");
  const c = compare(res([row("a")]), res([row("a", { asked: 9 })]));
  assert.equal(c.verdict, "差なし");
  assert.equal(c.changed, true);
});

test("良くなった所があっても、1 つでも退行があれば「退行あり」", () => {
  const c = compare(res([row("a"), row("b")]), res([row("a", { recovery: { correct: 15, total: 20 } }), row("b", { planMade: false, recovery: { correct: 0, total: 20 } })]));
  assert.equal(c.verdict, "退行あり");
  assert.ok(c.worse.some((x) => x.startsWith("b：計画")));
  assert.ok(c.better.some((x) => x.startsWith("a：⑥")));
});

test("未解決のセル・開いたままの問いが増える、施設が消える、測れなくなるのは退行", () => {
  assert.equal(compare(res([row("a")]), res([row("a", { unresolvedAfter: 4 })])).verdict, "退行あり");
  assert.equal(compare(res([row("a")]), res([row("a", { open: 1 })])).verdict, "退行あり");
  assert.equal(compare(res([row("a"), row("b")]), res([row("a")])).verdict, "退行あり");
  assert.equal(compare(res([row("a")]), res([row("a", { error: "道具が投げた" })])).verdict, "退行あり");
});

test("パックが違う結果・形の違う結果は比べない", () => {
  assert.throws(() => compare(res([row("a")], "p"), res([row("a")], "q")));
  assert.throws(() => compare({ schema: "x", facilities: [] }, res([])));
});

test("表に、変わった数を「前 → 後」で出す", () => {
  const b = res([row("a")]);
  const h = res([row("a", { unresolvedAfter: 0, recovery: { correct: 12, total: 20 } })]);
  const md = toMarkdown(b, h, compare(b, h));
  assert.match(md, /判定：\*\*良くなった\*\*/);
  assert.match(md, /10 → 12/);
});

test("合った数が増えても、読みすぎ（正解に無いのに読んだ数）が増えれば退行", () => {
  const c = compare(res([row("a", { extra: 0 })]), res([row("a", { extra: 40, accuracy: { correct: 6, total: 6 } })]));
  assert.equal(c.verdict, "退行あり");
  assert.ok(c.worse.some((x) => x.includes("読みすぎ")));
});

test("分母が変われば changed（--strict が拾う）。判定には使わず、注に出す", () => {
  const c = compare(res([row("a")]), res([row("a", { recovery: { correct: 10, total: 25 } })]));
  assert.equal(c.verdict, "差なし");
  assert.equal(c.changed, true);
  assert.ok(c.notes.some((x) => x.includes("⑥ の分母")));
});
