// 周期の案（docs/plan.md §2.18.4）：chart_propose の規則で、最後の実施から n 年ごとに計画の印を引く。足すだけ・計画のある年度は飛ばす・
// 実施が無い／終わりの年度が足りない作業は置かずに数える。引いた印は作者 AI、出どころは台帳、決定は案ごとにまとまる。
import { describe, expect, it } from "vitest";
import { pendingDecisions } from "../../src/plan/diff";
import { LEDGER_SOURCE, cycleIdOf, cycleYearsOf, proposeCycles } from "../../src/plan/cycle";
import type { Rule } from "../../src/shared/tools";
import { asset, detail, plan, work } from "./share/fixtures";

const rule = (years: number | string, names: string[]): Rule => ({ when: [{ field: "assetNode.name", op: "in", values: names }], set: { field: "work.trigger", value: years }, reason: "似た施設 6 の帯 5〜6 年" });
const base = () =>
  plan({
    assets: [asset("a1", "T.FEED.LIFT", { name: "押込送風機" }), asset("a2", "T.POWER.GEN", { name: "誘引通風機" }), asset("a3", "T.POWER.GEN", { name: "空気予熱器" })],
    works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "OVERHAUL", ["a2"]), work("w3", "OVERHAUL", ["a3"])],
    details: [
      detail("d1", "w1", 2016),
      detail("d2", "w1", 2021),
      detail("d3", "w1", 2031, { planOrActual: "plan" }),
      detail("d4", "w2", 2030),
      // w3 は実施が無い（計画だけ）
      detail("d5", "w3", 2027, { planOrActual: "plan" }),
      detail("d6", "w1", 2036),
    ],
  });

describe("周期の案", () => {
  it("規則の形：置く欄は作業のきっかけ、値は 1〜30 の整数の年数", () => {
    expect(cycleYearsOf(rule(5, ["x"]))).toBe(5);
    expect(cycleYearsOf(rule("6", ["x"]))).toBe(6);
    for (const bad of [0, 31, 2.5, "五"]) expect(cycleYearsOf(rule(bad as number, ["x"])), String(bad)).toBeNull();
    expect(cycleYearsOf({ ...rule(5, ["x"]), set: { field: "work.attribute", value: 5 } })).toBeNull();
    const r = proposeCycles(base(), [rule(5, ["押込送風機"]), rule(0, ["誘引通風機"])], { nextId: () => "L1", basis: "公開の台帳" });
    expect(r).toEqual({ ok: false, code: "rule_invalid", ruleIndex: 1 });
  });

  it("最後の実施から n 年ごと、終わりの年度（計画のいちばん遅い年度）まで。実施が無い作業と、終わりの年度が足りない作業は置かずに数える", () => {
    const p = base();
    let n = 0;
    const r = proposeCycles(p, [rule(5, ["押込送風機", "誘引通風機", "空気予熱器"])], { nextId: () => `L${++n}`, basis: "公開の台帳（版 abc1234）・似た施設 6" });
    if (!r.ok) throw new Error(r.code);
    const [c] = r.proposals;
    // 終わりの年度は 2036。w1：最後の実施が 2036 なので、その先は引けない（noHorizon）
    // w2：最後の実施 2030 → 2035 に置く。w3：実施が無いので置かない（noActual）
    expect(c).toMatchObject({ id: "L1", years: 5, works: 3, skipped: { noActual: 1, noHorizon: 1 } });
    expect(c!.detailKeys).toEqual(["cy-L1-w2-2035"]);
    const added = r.plan.details.find((d) => d.detailKey === "cy-L1-w2-2035")!;
    expect(added).toMatchObject({ planOrActual: "plan", fiscalYear: 2035, author: "ai", sources: [{ file: LEDGER_SOURCE }] });
    expect(added.basis).toContain("公開の台帳（版 abc1234）・似た施設 6");
    expect(added.basis).toContain("5 年ごと");
    // 前の明細はそのまま（足すだけ）
    expect(r.plan.details.slice(0, p.details.length)).toEqual(p.details);
    // 決定は明細ごとに出るが、案の ID でまとめられる
    expect(pendingDecisions(r.plan, []).filter((d) => d.id === "detail:cy-L1-w2-2035")).toHaveLength(1);
    expect(cycleIdOf("cy-L1-w2-2035")).toBe("L1");
    expect(cycleIdOf("d1")).toBeNull();
  });

  it("計画の印がもうある年度には足さない（足すだけで、今ある印を動かさない）", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT", { name: "押込送風機" })],
      works: [work("w1", "OVERHAUL", ["a1"])],
      details: [detail("d1", "w1", 2016), detail("d2", "w1", 2021, { planOrActual: "plan" }), detail("d3", "w1", 2026), detail("d4", "w1", 2031, { planOrActual: "plan" })],
    });
    const r = proposeCycles(p, [rule(5, ["押込送風機"])], { nextId: () => "L9", basis: "公開の台帳" });
    if (!r.ok) throw new Error(r.code);
    // 最後の実施 2026 → 2031 は計画がもうある。終わりの年度は 2031 なので、それより先は引かない
    expect(r.proposals[0]!.detailKeys).toEqual([]);
    const r2 = proposeCycles(p, [rule(5, ["押込送風機"])], { nextId: () => "L9", basis: "公開の台帳" });
    expect(r2.ok && r2.plan.details.length).toBe(p.details.length);
  });
});
