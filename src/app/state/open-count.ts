// 未確定の数（受けるか退けるかを待つもの）：HOSHITORI の確定のシート・シートのタブの数と、MOYAI のトップの「作業中　未確定 n」が
// 同じ数え方・同じ元で数える（運営者が M-PC3 で見つけた食い違い、2026-11-18：トップは前の版で受けた決定まで数えていた）。
// 数えるもの：前の版までに同じ中身で受けていない AI の決定（pendingDecisions。当てはめの案で押さえている行は案の側で数える）のうち、
// このタブでまだ受けていないもの ＋ 案のままの当てはめの規則 ＋ 案のままの星取の削除。
import { pendingDecisions, type Decision } from "../../plan/diff";
import { heldRows, type CrosswalkProposal } from "../../plan/crosswalk";
import type { Plan } from "../../shared/plan";

/** 確定のシートに並ぶ、前の版までに受けていない決定（案で押さえている行の決定は除く） */
export function pendingFor(plan: Plan, history: readonly { id: string; hash: string }[], proposals: readonly CrosswalkProposal[]): Decision[] {
  const held = new Set<string>();
  for (const p of proposals) if (p.state === "proposed") for (const ref of heldRows(plan, p)) held.add(ref.startsWith("n:") ? `item:${ref.slice(2)}` : `attr:${ref.slice(2)}`);
  return pendingDecisions(plan, history).filter((d) => !held.has(d.id));
}

/** 未確定の数（確定のシートのタブの数・トップの「未確定 n」） */
export function openDecisionCount(
  plan: Plan,
  history: readonly { id: string; hash: string }[],
  proposals: readonly CrosswalkProposal[],
  isAccepted: (id: string, hash: string) => boolean,
  openRemovals: number,
): number {
  const pending = pendingFor(plan, history, proposals).filter((d) => !isAccepted(d.id, d.hash)).length;
  return pending + proposals.filter((p) => p.state === "proposed").length + openRemovals;
}
