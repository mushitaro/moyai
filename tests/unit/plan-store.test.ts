// 作業中の計画の置き場：置くたびに版が増え、読む側に知らせる。
import { describe, expect, it } from "vitest";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
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
});
