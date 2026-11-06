// 作業明細（運営者の定義、2026-11-06：作業日報の 1 行。Architect の台帳の 43）：
// 作業の年度の値（WorkDetail）にまとめる前の日報の行を、足し上げずに lines に残す。
// 年度の値の工数は、lines の工数（決定で工数を外した行を除く）の和と合う。日付は年度の中で、外なら null と印
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { fiscalYearOf } from "../../../src/plan/chart";

const PACK = "waste-incineration";
const DIR = `samples/out/${PACK}/fictional-1/`;
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];
const CTX = { conversation: "c-lines", rowsRemaining: 2000 };

describe("作業明細（日報の行）", () => {
  it("日報のある作業の年度の値は、日報の行を持ち、工数の和が合い、日付は年度の中", async () => {
    try {
      const ws = new IntakeWorkspace({ packId: PACK, facilityName: "【架空】作業明細の試験", fiscalYearStartMonth: 4, fictional: true });
      await ws.addFiles(FILES.map((n) => {
        const b = new Uint8Array(readFileSync(DIR + n));
        return { name: n, size: b.length, bytes: async () => b };
      }));
      for (let i = 0; i < 15; i++) {
        const s = runTabTool(ws, "intake_survey", { part: "questions" }, CTX);
        const qs = s.ok ? ((s.data as { questions: { questionId: string; defaultAnswer: string | null }[] }).questions ?? []) : [];
        if (!qs.length) break;
        const ds = qs.filter((q) => q.defaultAnswer !== null).map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "試験の台本" }));
        for (let k = 0; k < ds.length; k += 50) runTabTool(ws, "intake_settle", { decisions: ds.slice(k, k + 50) }, CTX);
      }
      runTabTool(ws, "intake_compose", {}, CTX);
      await ws.whenComposed();
      const plan = getWorkingPlan()!.plan;
      const withLines = plan.details.filter((d) => d.lines && d.lines.length > 0);
      expect(withLines.length).toBeGreaterThan(0);
      for (const d of withLines) {
        const lines = d.lines!;
        // 日付は年度の中（外なら null と印）
        for (const l of lines) if (l.date) expect(fiscalYearOf(l.date, 4)).toBe(d.fiscalYear);
        for (const l of lines) if (l.flag === "outOfYear") expect(l.date).toBeNull();
        // 工数の和（工数を外した行を除く）
        if (d.manDays !== null && lines.every((l) => l.manDays !== null || l.flag === "effortExcluded")) {
          const sum = lines.filter((l) => l.flag !== "effortExcluded").reduce((n, l) => n + (l.manDays ?? 0), 0);
          expect(Math.abs(sum - d.manDays), `${d.detailKey}`).toBeLessThan(1e-6);
        }
        expect(lines.every((l) => l.source.file === "daily-report.csv" || l.source.file.endsWith(".pdf") || l.source.file.endsWith(".xlsx"))).toBe(true);
      }
    } finally {
      clearWorkingPlan();
    }
  });
});
