// 確定のシートと下の帯（Architect の 44、Wire、11-06）：同じ作業に年数の違う周期の案を 2 つとも受けたら「周期の案の重複 n」（n は作業の数）で止める
import { describe, expect, it } from "vitest";
import { cycleConflicts } from "../../src/app/components/DecisionsSheet";
import { proposeCycles } from "../../src/plan/cycle";
import { pendingDecisions, type Acceptance } from "../../src/plan/diff";
import { TEXT } from "../../src/app/text";
import type { Plan } from "../../src/shared/plan";
import type { Rule } from "../../src/shared/tools";
import { asset, detail, plan, work } from "./share/fixtures";

const rule = (years: number): Rule => ({ when: [{ field: "assetNode.name", op: "in", values: ["押込送風機"] }], set: { field: "work.trigger", value: years }, reason: "利用者の言葉" });
const propose = (p: Plan, years: number, id: string) => {
  const r = proposeCycles(p, [rule(years)], { nextId: () => id, basis: "会話", fromLedger: false, author: "ai_relayed_human" });
  if (!r.ok) throw new Error(r.code);
  return r.plan;
};
const base = () =>
  plan({
    assets: [asset("a1", "T.FEED.LIFT", { name: "押込送風機" })],
    works: [work("w1", "OVERHAUL", ["a1"])],
    details: [detail("d1", "w1", 2018), detail("d2", "w1", 2022), detail("d3", "w1", 2032, { planOrActual: "plan" })],
  });
const acceptedOf = (p: Plan, ids: string[]) => {
  const m = new Map<string, Acceptance>();
  for (const d of pendingDecisions(p, [])) if (ids.some((id) => d.id.startsWith(`detail:cy-${id}-`))) m.set(`${d.id}\u0000${d.hash}`, { id: d.id, hash: d.hash, reason: "画面で見て受けた" });
  return m;
};

describe("周期の案の重複", () => {
  it("年数の違う案を 2 つとも受けると、その作業の数を返す。片方だけなら 0", () => {
    const p = propose(propose(base(), 4, "C1"), 3, "C2");
    expect(cycleConflicts(p, acceptedOf(p, ["C1", "C2"]))).toEqual(["w1"]);
    expect(cycleConflicts(p, acceptedOf(p, ["C1"]))).toEqual([]);
    expect(cycleConflicts(null, new Map())).toEqual([]);
    expect(TEXT.merge.block.cycleDup(1)).toBe("周期の案の重複 1");
  });
});
