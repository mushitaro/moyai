// 階層の名前（docs/plan.md §2.2。運営者の指摘、11-06）：資料の見出しに名前の無い階層は、パックの階層の名前（pack.json の levelNames）を既定にする。
// デモの施設（fictional-1）の台帳は「設備・機器」の見出しだけで、部位の階層の名前が無い。前は「第3階層」と出ていた
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";

const DIR = "samples/out/waste-incineration/fictional-1/";
const CTX = { conversation: "c-levels", rowsRemaining: 2000 };

describe("階層の名前", () => {
  it("見出しに名前の無い第 3 階層は、パックの名前（部位）になる", async () => {
    try {
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】階層の名前", fiscalYearStartMonth: 4, fictional: true });
      await ws.addFiles(["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"].map((n) => {
        const b = new Uint8Array(readFileSync(DIR + n));
        return { name: n, size: b.length, bytes: async () => b };
      }));
      for (let i = 0; i < 15; i++) {
        const s = runTabTool(ws, "intake_survey", { part: "questions" }, CTX);
        const qs = s.ok ? ((s.data as { questions: { questionId: string; defaultAnswer: string | null }[] }).questions ?? []) : [];
        if (!qs.length) break;
        runTabTool(ws, "intake_settle", { decisions: qs.filter((q) => q.defaultAnswer !== null).map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "試験の台本" })) }, CTX);
      }
      runTabTool(ws, "intake_compose", {}, CTX);
      await ws.whenComposed();
      expect(getWorkingPlan()!.plan.levelNames).toEqual(["設備", "機器", "部位"]);
    } finally {
      clearWorkingPlan();
    }
  }, 300_000);
});
