// 未確定の数（運営者が M-PC3 で見つけた食い違い、2026-11-18）：MOYAI のトップの「作業中　未確定 n」と、HOSHITORI の確定のシートの数が
// 同じ数え方・同じ元で数える。前の版までに受けた決定は、どちらも数えない（トップは前の版で受けた決定まで数えていた）。
// 計画はすべて架空。
import { afterEach, describe, expect, it } from "vitest";
import { aiDecisions, pendingDecisions } from "../../src/plan/diff";
import { acceptDecision, clearAccepted, isAccepted } from "../../src/app/state/decisions";
import { setAcceptHistory } from "../../src/app/state/history";
import { openDecisionCount, pendingFor } from "../../src/app/state/open-count";
import { openCount } from "../../src/app/state/work";
import type { Plan } from "../../src/shared/plan";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";

afterEach(() => {
  clearAccepted();
  setAcceptHistory("", []);
});

/** HOSHITORI の確定のシートのタブの数（Merge の leftDecisions と同じ足し方。案・削除は無い） */
const hoshitoriLeft = (plan: Plan, history: { id: string; hash: string }[]) => pendingFor(plan, history, []).filter((d) => !isAccepted(d.id, d.hash)).length;

describe("トップの未確定の数と HOSHITORI の数", () => {
  it("前の版で受けた決定は、トップも HOSHITORI も数えない。このタブで受けると、どちらも減って 0 になる", () => {
    const plan = truthToPlan("fictional-1") as Plan;
    const all = aiDecisions(plan);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // 前の版で、1 つを除いて同じ中身で受けた（版の記録の accepted）
    const history = all.slice(0, all.length - 1).map((d) => ({ id: d.id, hash: d.hash }));
    setAcceptHistory(plan.planId, history.map((h) => ({ ...h, reason: "前の版で受けた", version: 1 })));
    expect(pendingDecisions(plan, history)).toHaveLength(1);
    // 前は aiDecisions をみな数えていた（全部の数）。今は前の版で受けていないものだけ
    expect(openCount(plan)).toBe(1);
    expect(openCount(plan)).toBe(hoshitoriLeft(plan, history));
    // このタブで残りを受けると、どちらも 0
    for (const d of pendingDecisions(plan, history)) expect(acceptDecision(d.id, d.hash, "受けた")).toBe(true);
    expect(openCount(plan)).toBe(0);
    expect(hoshitoriLeft(plan, history)).toBe(0);
  });

  it("版の履歴を読んでいない（ほかの計画の履歴しか無い）ときは、前の版の受けた決定は無いものとして数える", () => {
    const plan = truthToPlan("fictional-1") as Plan;
    setAcceptHistory("ほかの計画", [{ id: aiDecisions(plan)[0]!.id, hash: aiDecisions(plan)[0]!.hash, reason: "x", version: 1 }]);
    expect(openCount(plan)).toBe(aiDecisions(plan).length);
  });

  it("案のままの当てはめの規則と星取の削除も、未確定に数える", () => {
    const plan = truthToPlan("fictional-1") as Plan;
    const history = aiDecisions(plan).map((d) => ({ id: d.id, hash: d.hash }));
    expect(openDecisionCount(plan, history, [], isAccepted, 0)).toBe(0);
    expect(openDecisionCount(plan, history, [], isAccepted, 2)).toBe(2);
  });
});
