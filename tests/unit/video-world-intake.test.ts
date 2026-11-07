// 動画の世界の 3 つの資料を、取り込み（画面の道の手前まで。ブラウザなし）で最後まで読み、
// 撮影の台本が AI の代わりに置く当てはめの規則（video/world/rules.ts）が衝突せず、主な機器に当たることを確かめる。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { acceptByHuman } from "../../src/app/state/crosswalk";
import { clearWorkingPlan, getWorkingPlan } from "../../src/app/state/plan-store";
import { hotaruRules } from "../../video/world/rules";

afterEach(() => clearWorkingPlan());
const CTX = { conversation: "c-video-world", rowsRemaining: 2000 };
const DIR = "video/world/hotarugawa/";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];
const ok = (r: ReturnType<typeof runTabTool>): any => {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
};

describe("ほたる川の資料を取り込む", () => {
  test("3 つの資料が計画になり、台本の当てはめの規則が衝突せず、主な機器の 6 つが共通の項目に当たる", async () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】ほたる川クリーンセンター", fiscalYearStartMonth: 4, fictional: true });
    await ws.addFiles(
      FILES.map((n) => {
        const b = new Uint8Array(readFileSync(DIR + n));
        return { name: n, size: b.length, bytes: async () => b };
      }),
    );
    for (let i = 0; i < 15; i++) {
      const s = ok(runTabTool(ws, "intake_survey", { part: "questions" }, CTX));
      if (!s.questions.length) break;
      ok(runTabTool(ws, "intake_settle", { decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで既定の答えでよいと言った" })) }, CTX));
    }
    ok(runTabTool(ws, "intake_compose", {}, CTX));
    await ws.whenComposed();
    const wp = getWorkingPlan();
    expect(wp).not.toBeNull();
    const { nodes, works } = hotaruRules();
    const r = ok(runTabTool(ws, "crosswalk_propose", { rules: [...nodes, ...works], basedOnVersion: wp!.revision }, CTX));
    expect(r.conflicts).toBe(0);
    for (const p of getWorkingPlan()!.proposals) expect(acceptByHuman(p.ruleId, "試験の台本が押した（台帳の名前とパックの項目を見て合っている）").ok).toBe(true);
    const plan = getWorkingPlan()!.plan;
    expect(plan.facility.name).toBe("【架空】ほたる川クリーンセンター");
    for (const name of ["火格子", "押込送風機", "誘引送風機", "ボイラ", "バグフィルタ", "蒸気タービン"]) {
      const hits = plan.assets.filter((a) => a.name === name);
      expect(hits.length, name).toBeGreaterThan(0);
      for (const a of hits) expect(a.commonItem, `${name} の共通の項目`).not.toBeNull();
    }
    // 年度は令和 6〜8 年度（2024〜2026）だけ
    expect([...new Set(plan.details.map((d) => d.fiscalYear))].sort()).toEqual([2024, 2025, 2026]);
    // 前のコピーの名前が計画のどこにも無い
    const text = JSON.stringify(plan);
    for (const w of ["みどり台", "東山", "kacho@", "fictional-1"]) expect(text).not.toContain(w);
  }, 180_000);
});
