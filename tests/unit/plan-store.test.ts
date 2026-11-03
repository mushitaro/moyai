// 作業中の計画の置き場：置くたびに版が増え、読む側に知らせる。
import { describe, expect, it } from "vitest";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan, updateWorkingPlan } from "../../src/app/state/plan-store";
import type { CrosswalkProposal } from "../../src/plan/crosswalk";
import { plan } from "./share/fixtures";

describe("plan-store", () => {
  it("置くたびに revision が増え、消すと null に戻る", () => {
    clearWorkingPlan();
    expect(getWorkingPlan()).toBeNull();
    const a = setWorkingPlan(plan({ assets: [], works: [], details: [] }), "dev");
    const b = setWorkingPlan(plan({ assets: [], works: [], details: [] }), "intake");
    expect(b.revision).toBe(a.revision + 1);
    expect(getWorkingPlan()?.origin).toBe("intake");
    clearWorkingPlan();
    expect(getWorkingPlan()).toBeNull();
  });

  it("中身を書き換えると版だけが増え、置いた回と出どころはそのまま。置き直すと当てはめの案の一覧は空に戻る", () => {
    clearWorkingPlan();
    expect(updateWorkingPlan(plan({ assets: [], works: [], details: [] }), [])).toBeNull();
    const a = setWorkingPlan(plan({ assets: [], works: [], details: [] }), "intake");
    const b = updateWorkingPlan(plan({ assets: [], works: [], details: [] }), [{ ruleId: "案 1" } as CrosswalkProposal]);
    expect(b?.revision).toBe(a.revision + 1);
    expect(b?.generation).toBe(a.generation);
    expect(b?.origin).toBe("intake");
    expect(b?.proposals).toHaveLength(1);
    const c = setWorkingPlan(plan({ assets: [], works: [], details: [] }), "intake");
    expect(c.generation).toBe(a.generation + 1);
    expect(c.proposals).toEqual([]);
    clearWorkingPlan();
  });
});
