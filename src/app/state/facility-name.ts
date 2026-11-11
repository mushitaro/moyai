// Claude の施設の名前の案を、作業中の計画に置く（mushitaro/moyai#56）。置くのは案（nameProposal）だけで、名前は変えない。
// 人が確定のシートで受けて署名すると、橋渡しが署名の前に名前を替える（src/plan/facility-name.ts の applyNameAcceptance）。
import { proposeName } from "../../plan/facility-name";
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
