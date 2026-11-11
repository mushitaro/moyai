// Claude の施設の名前の案を、作業中の計画に置く（mushitaro/moyai#56）。置くのは案（nameProposal）だけで、名前は変えない。
// 人が確定のシートで受けて署名すると、橋渡しが署名の前に名前を替える（src/plan/facility-name.ts の applyNameAcceptance）。
import { proposeName } from "../../plan/facility-name";
import type { Plan } from "../../shared/plan";
import { getWorkingPlan, updateWorkingPlan } from "./plan-store";

export type NameFromAi = { ok: true; state: "proposed" | "same" } | { ok: false; code: "no_working_plan" | "facility_name_invalid" | "facility_name_fictional" };

/** 確かめるだけ（置かない）。ほかの案と一緒のとき、先に確かめて、合わなければどの案も置かない */
export function checkNameFromAi(name: string, author: "ai" | "ai_relayed_human", basis: string): NameFromAi {
  const wp = getWorkingPlan();
  if (!wp) return { ok: false, code: "no_working_plan" };
  const r = proposeName(wp.plan, name, author, basis);
  return r.ok ? { ok: true, state: r.state } : { ok: false, code: r.code };
}

/** 案を置く（今と同じ名前なら案を消す） */
export function proposeNameFromAi(name: string, author: "ai" | "ai_relayed_human", basis: string): NameFromAi {
  const wp = getWorkingPlan();
  if (!wp) return { ok: false, code: "no_working_plan" };
  const r = proposeName(wp.plan, name, author, basis);
  if (!r.ok) return { ok: false, code: r.code };
  updateWorkingPlan(r.plan, wp.proposals);
  return { ok: true, state: r.state };
}

// ─── 作り直しをまたいで名前を残す ──────────────────────────────
// 取り込みが計画を作り直すと、名前は作業場の施設名の欄から作られる。見出しで人が直した名前と、Claude の名前の案は、
// 作り直した計画に引き継ぐ（作り直しで黙って戻らないように。見直しの指摘、#56）。計画の ID が同じときだけ。
let humanName: { planId: string; name: string } | null = null;

/** 人が見出しで直した名前を覚える（作り直しのあとも、この名前にする） */
export function rememberHumanName(planId: string, name: string): void {
  humanName = { planId, name };
}

/** 作り直した計画に、人が直した名前と、前の計画の名前の案を引き継ぐ */
export function carryNames(prev: Plan | null, next: Plan): Plan {
  let out = next;
  if (humanName && humanName.planId === next.planId && humanName.name !== next.displayName) {
    out = { ...out, displayName: humanName.name, facility: { ...out.facility, name: humanName.name } };
  }
  if (prev && prev.planId === next.planId && prev.nameProposal && !out.nameProposal) out = { ...out, nameProposal: prev.nameProposal };
  return out;
}
