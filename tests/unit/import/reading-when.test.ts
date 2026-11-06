// when が効かない種類の規則（同じ機器・決まった答え・計画ルール）に when を付けたら断る（Architect の 57。黙って広く当てない）
import { describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan } from "../../../src/app/state/plan-store";

const CTX = { conversation: "c-when", rowsRemaining: 2000 };
const base = { text: "「BFP」と「ボイラ給水ポンプ」は同じ機器", author: "ai", reason: "利用者の言葉" };

describe("規則の when", () => {
  it("同じ機器の規則に when を付けると断り、外せば置ける", () => {
    try {
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】甲工場", fiscalYearStartMonth: 4, fictional: true });
      const rule = { ...base, id: "s1", kind: "sameAsset", names: ["BFP", "ボイラ給水ポンプ"] };
      const ng = runTabTool(ws, "reading_rules_propose", { name: "甲工場の読み方", scope: "facility", rules: [{ ...rule, when: { file: "日報*.csv" } }] }, CTX);
      expect(ng).toEqual({ ok: false, code: "reading_when_ignored" });
      const ok = runTabTool(ws, "reading_rules_propose", { name: "甲工場の読み方", scope: "facility", rules: [rule] }, CTX);
      expect(ok.ok).toBe(true);
    } finally {
      clearWorkingPlan();
    }
  });
});
