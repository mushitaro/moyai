// 試験だけの道具：工場の fictional-1 の資料を取り込み（crosswalk.test.ts と同じ道）、当てはめの規則を AI の代わりに置き、
// 試験の台本が人の代わりに規則ごとに受けた計画を、作業中の計画に置く。検査の試験（④ の物差しとツール）が使う。
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { acceptByHuman } from "../../../src/app/state/crosswalk";
import { getWorkingPlan } from "../../../src/app/state/plan-store";
import { f1Rules } from "../../fixtures/crosswalk/rules";

export const PACK = "waste-incineration";
export const FACILITY = "fictional-1";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];
export const CTX = { conversation: "c-review", rowsRemaining: 2000 };
const HUMAN = "試験の台本が押した（台帳の名前とパックの項目を見て合っている）";

export const ok = (r: ReturnType<typeof runTabTool>): any => {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
};

export async function composeFictional1(facilityName: string): Promise<IntakeWorkspace> {
  const ws = new IntakeWorkspace({ packId: PACK, facilityName, fiscalYearStartMonth: 4, fictional: true });
  const dir = `samples/out/${PACK}/${FACILITY}/`;
  await ws.addFiles(
    FILES.map((n) => {
      const b = new Uint8Array(readFileSync(dir + n));
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
  const { nodes, works } = f1Rules();
  ok(runTabTool(ws, "crosswalk_propose", { rules: [...nodes, ...works], basedOnVersion: getWorkingPlan()!.revision }, CTX));
  for (const p of getWorkingPlan()!.proposals) expect(acceptByHuman(p.ruleId, HUMAN).ok).toBe(true);
  return ws;
}
