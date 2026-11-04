// 周期の案を作業中の計画に置く（AI の chart_propose の受け手。docs/plan.md §2.18.4）。当てはめの案（state/crosswalk.ts の proposeFromAi）と同じく、
// AI のツールの受け手（intake/tab-tools.ts）は計画を直に書き換えず、この関数を通す。置くのは作者が AI の計画の印だけで、受けるのは人（決定のシート）。
import { proposeCycles, type CycleProposal } from "../../plan/cycle";
import type { Plan } from "../../shared/plan";
import type { Rule } from "../../shared/tools";
import { getWorkingPlan, updateWorkingPlan } from "./plan-store";

let seq = 0;

export type CyclesOutcome = { ok: true; plan: Plan; proposals: CycleProposal[]; version: number } | { ok: false; code: "no_working_plan" | "stale_version" | "tool_failed" };

export function proposeCyclesFromAi(rules: Rule[], basedOnVersion: number, basis: string): CyclesOutcome {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  if (basedOnVersion !== working.revision) return { ok: false, code: "stale_version" };
  const r = proposeCycles(working.plan, rules, { nextId: () => `L${++seq}`, basis });
  if (!r.ok) return { ok: false, code: "tool_failed" };
  const next = updateWorkingPlan(r.plan, working.proposals);
  return { ok: true, plan: r.plan, proposals: r.proposals, version: next?.revision ?? working.revision };
}
