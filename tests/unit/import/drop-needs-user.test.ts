// 外す答え（意味の決まらないセル・行・列を外す、資料を参考として外す、読めない資料を外す）は、人の言葉を受けたとき（ai_relayed_human）だけ置ける。
// AI の判断だけ（author: ai）では断り、何も置かない（2026-11-25 運営者の困りごと「標準に合わないから資料を落とす方向に流れる」）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { DROP_ANSWERS, runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan } from "../../../src/app/state/plan-store";
import { ERRORS } from "../../../src/shared/errors";
import { skillMoyaiMarkdown } from "../../../src/shared/skill-moyai";
import { MCP_INSTRUCTIONS } from "../../../src/shared/instructions";

const CTX = { conversation: "c-drop", rowsRemaining: 2000 };
/** デモの財務会計の CSV（【架空】。標準の読み方では「外す」だけの問いが出る） */
const DIR = "packs/waste-incineration/demo";
const LEDGER = readdirSync(DIR).find((f) => f.includes("財務会計CSV"))!;
const ledger = new Uint8Array(readFileSync(join(DIR, LEDGER)));

describe("外す答えは人の言葉で", () => {
  it("author ai の exclude は断り（drop_needs_user）、何も置かない。ai_relayed_human なら置ける", async () => {
    try {
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】甲浜クリーンセンター", fiscalYearStartMonth: 4, fictional: true });
      await ws.addFiles([{ name: LEDGER, size: ledger.length, bytes: async () => ledger }]);
      await ws.fresh();
      const q = ws.analysis().open.find((x) => x.options.some((o) => o.id === "exclude"));
      expect(q).toBeDefined();
      const ng = runTabTool(ws, "intake_settle", { decisions: [{ questionId: q!.questionId, answer: "exclude", author: "ai", reason: "標準に合わない" }] }, CTX);
      expect(ng).toEqual({ ok: false, code: "drop_needs_user" });
      expect(ws.analysis().open.find((x) => x.questionId === q!.questionId)?.decision ?? null).toBeNull();
      const ok = runTabTool(ws, "intake_settle", { decisions: [{ questionId: q!.questionId, answer: "exclude", author: "ai_relayed_human", reason: "利用者が、この列は要らないと答えた" }] }, CTX);
      expect(ok.ok).toBe(true);
    } finally {
      clearWorkingPlan();
    }
  });

  it("断りの文と 1 段目の Skill は、構造を読んで規則で読み切ることを言う", () => {
    expect([...DROP_ANSWERS].sort()).toEqual(["exclude", "reference", "reject"]);
    expect(ERRORS.drop_needs_user.text).toMatch(/ai_relayed_human/);
    expect(ERRORS.drop_needs_user.text).toMatch(/form/);
    expect(ERRORS.drop_needs_user.text).toMatch(/contractColumn/);
    const skill = skillMoyaiMarkdown();
    expect(skill).toContain("### Read every file");
    expect(skill).toMatch(/-> form \(title, fields, lines/);
    expect(skill).toMatch(/-> contractColumn/);
    expect(MCP_INSTRUCTIONS).toContain("\"Read every file\"");
  });
});
