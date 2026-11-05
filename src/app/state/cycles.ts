// 周期の案を作業中の計画に置く（AI の chart_propose の受け手。docs/plan.md §2.18.4）。当てはめの案（state/crosswalk.ts の proposeFromAi）と同じく、
// AI のツールの受け手（intake/tab-tools.ts）は計画を直に書き換えず、この関数を通す。置くのは作者が AI の計画の印だけで、受けるのは人（決定のシート）。
import { LEDGER_CYCLE_PREFIX, proposeCycles, type CycleProposal } from "../../plan/cycle";
import type { Plan } from "../../shared/plan";
import type { Rule } from "../../shared/tools";
import { getWorkingPlan, updateWorkingPlan } from "./plan-store";

let seq = 0;

export type CyclesOutcome = { ok: true; plan: Plan; proposals: CycleProposal[]; version: number } | { ok: false; code: "no_working_plan" | "stale_version" | "tool_failed" };

export function proposeCyclesFromAi(rules: Rule[], basedOnVersion: number, basis: string, o: { fromLedger: boolean; author?: "ai" | "ai_relayed_human" } = { fromLedger: false }): CyclesOutcome {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  if (basedOnVersion !== working.revision) return { ok: false, code: "stale_version" };
  // 台帳を照らした案は L、ほかは C の頭の ID（決定のシートの種類を分ける）
  const r = proposeCycles(working.plan, rules, { nextId: () => `${o.fromLedger ? LEDGER_CYCLE_PREFIX : "C"}${++seq}`, basis, fromLedger: o.fromLedger, ...(o.author ? { author: o.author } : {}) });
  if (!r.ok) return { ok: false, code: "tool_failed" };
  const next = updateWorkingPlan(r.plan, working.proposals);
  return { ok: true, plan: r.plan, proposals: r.proposals, version: next?.revision ?? working.revision };
}
