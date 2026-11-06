// 作業明細（日報の行）の内容・備考・作業量は当施設の画面だけに出す（Architect の 43・54）。
// 見張りの字を日報の備考と作業量に入れ、計画の作業明細には入るが、AI のツールの結果（intake_survey の compose・chart_rows・check_results）に出ないことを 1 本で確かめる
import { describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";

const REMARK = "見張備考七三九";
const QTY = "見張数量八四一";
const CTX = { conversation: "c-lines-sentinel", rowsRemaining: 2000 };
const enc = new TextEncoder();
const CSV = ["日付,機器,作業内容,数量,工数(人日),備考", `2022-05-10,押込送風機,分解整備,${QTY},3,${REMARK}`, "2022-05-11,押込送風機,分解整備,,2,"].join("\r\n");

describe("作業明細の字は AI の結果に出ない", () => {
  it("compose・chart_rows・check_results の結果に、備考と作業量の見張りの字が無い", async () => {
    try {
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】明細の見張り", fiscalYearStartMonth: 4, fictional: true });
      const b = enc.encode(CSV);
      await ws.addFiles([{ name: "日報.csv", size: b.length, bytes: async () => b }]);
      for (let i = 0; i < 10; i++) {
        const s = runTabTool(ws, "intake_survey", { part: "questions" }, CTX);
        const qs = s.ok ? ((s.data as { questions: { questionId: string; defaultAnswer: string | null; options: { id: string }[] }[] }).questions ?? []) : [];
        if (!qs.length) break;
        runTabTool(ws, "intake_settle", { decisions: qs.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer ?? q.options[0]?.id ?? "", author: "ai_relayed_human", reason: "試験の台本" })) }, CTX);
      }
      runTabTool(ws, "intake_compose", {}, CTX);
      await ws.whenComposed();
      const lines = getWorkingPlan()!.plan.details.flatMap((d) => d.lines ?? []);
      expect(lines.some((l) => l.remark === REMARK && l.quantity === QTY)).toBe(true);
      const seen = [
        runTabTool(ws, "intake_survey", { part: "compose" }, CTX),
        runTabTool(ws, "chart_rows", { view: "adjusted", offset: 0, limit: 200 }, CTX),
        runTabTool(ws, "check_results", {}, CTX),
      ];
      // 中身のある答えで確かめる（誤りの答えなら字が無いのは当たり前）
      expect(seen.map((r) => r.ok)).toEqual([true, true, true]);
      const texts = seen.map((r) => JSON.stringify(r));
      for (const t of texts) {
        expect(t.includes(REMARK), t.slice(0, 200)).toBe(false);
        expect(t.includes(QTY), t.slice(0, 200)).toBe(false);
      }
    } finally {
      clearWorkingPlan();
    }
  });
});
