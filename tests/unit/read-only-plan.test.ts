// 確定した版を見るだけで開いたとき（運営者の判断 2026-11-18 夜）：作業中の計画は書き換わらない（星・案・名前を動かせない）、
// AI の案・決定・作り直しは断る（plan_read_only）、星取表の行は橋渡しが保管先の確定した版から読む（作業画面は作業中の計画が無いと答える）。
// 計画はすべて架空。
import { afterEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan, updateWorkingPlan } from "../../src/app/state/plan-store";
import { moveStarByHuman } from "../../src/app/state/stars";
import { ERRORS } from "../../src/shared/errors";
import type { Plan } from "../../src/shared/plan";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";

afterEach(() => clearWorkingPlan());

const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】見るだけの試験", fiscalYearStartMonth: 4, fictional: true });
const CTX = { conversation: "c-ro", rowsRemaining: 2000 };

describe("見るだけで開いた版", () => {
  it("書き換え（星の試し・名前・案）は効かない", () => {
    const plan = { ...(truthToPlan("fictional-1") as Plan), version: 1 };
    const w = setWorkingPlan(plan, "intake", [], 1, true);
    expect(w.readOnly).toBe(true);
    expect(updateWorkingPlan({ ...plan, displayName: "【架空】変えた名前" }, [])).toBeNull();
    const d = plan.details.find((x) => x.planOrActual === "plan")!;
    moveStarByHuman(d.workKey, d.fiscalYear, d.fiscalYear + 1, { min: 1900, max: 2200 });
    expect(getWorkingPlan()!.plan).toBe(plan);
    expect(getWorkingPlan()!.revision).toBe(w.revision);
  });

  it("AI の案・決定・作り直しは plan_read_only で断り、星取表の行は作業中の計画が無いと答える（橋渡しが確定した版を読む）", () => {
    const plan = { ...(truthToPlan("fictional-1") as Plan), version: 1 };
    setWorkingPlan(plan, "intake", [], 1, true);
    const w = ws();
    const propose = runTabTool(w, "chart_propose", { basedOnVersion: 0, basis: "試し", author: "ai_relayed_human", facilityName: "【架空】動かない名前" }, CTX);
    expect(propose).toEqual({ ok: false, code: "plan_read_only" });
    expect(runTabTool(w, "intake_compose", {}, CTX)).toEqual({ ok: false, code: "plan_read_only" });
    expect(runTabTool(w, "crosswalk_propose", { rules: [{ ruleId: "r1", when: [{ field: "assetNode.name", op: "equals", values: ["x"] }], set: { field: "assetNode.commonItem", value: "X" }, basis: "b" }], basedOnVersion: 0 }, CTX)).toEqual({ ok: false, code: "plan_read_only" });
    expect(runTabTool(w, "chart_rows", { offset: 0, limit: 5, view: "adjusted" }, CTX)).toEqual({ ok: false, code: "no_working_plan" });
    expect(ERRORS.plan_read_only.text).toContain('"+ Next version"');
    expect(ERRORS.plan_read_only.text).toContain("Reply in the user's language");
  });

  it("書ける計画（＋ 次の版で開いた計画）は今のまま書き換わる", () => {
    const plan = { ...(truthToPlan("fictional-1") as Plan), version: 1 };
    setWorkingPlan(plan, "intake", [], 1);
    expect(updateWorkingPlan({ ...plan, displayName: "【架空】変えた名前" }, [])).not.toBeNull();
  });
});
