// 星取の案を作業中の計画に置く（AI の chart_propose の stars の受け手。src/plan/star.ts）。周期の案（state/cycles.ts）と同じく、
// AI のツールの受け手（intake/tab-tools.ts）は計画を直に書き換えず、この関数を通す。
// - 足す案：作者が AI の作業明細を計画に足す。人が確定のシートで受ける（state/decisions.ts）か、却下する（state/cycles.ts の rejectCycleByHuman）。
// - 消す案：計画は変えず、ここ（このタブのメモリ）に置く。人が確定のシートで受けたときだけ、その明細を作業中の計画から外す（人の道）。
//   受けたあとに取り消すと、外した明細を戻す。却下すると案を捨てる。置き直した回（generation）が変われば、前の回の案は出さない。
import { useSyncExternalStore } from "react";
import { STAR_PREFIX, checkStars, proposeStars, removalBasis, removalTargets, workKeyOfRef, type PlacedStar, type StarCode, type StarIn, type StarValue } from "../../plan/star";
import type { VerifiedBases } from "../../plan/cycle";
import type { WorkDetailT } from "../../shared/plan";
import type { TabSentCode } from "../../shared/errors";
import { getWorkingPlan, updateWorkingPlan } from "./plan-store";

/** 星取の案の確かめの答え → AI に返す誤り（作業画面が送り手。src/shared/errors.ts） */
const SENT: Record<StarCode, TabSentCode> = {
  star_work_unknown: "star_work_unknown",
  star_out_of_range: "star_out_of_range",
  star_unknown: "star_unknown",
  star_basis_invalid: "star_basis_invalid",
};

export interface StarRemoval {
  id: string;
  workKey: string;
  value: StarValue;
  fiscalYear: number;
  /** 消す明細の鍵（置いたときの） */
  detailKeys: string[];
  basis: string;
  author: "ai" | "ai_relayed_human";
  generation: number;
  state: "proposed" | "accepted" | "rejected";
  /** 人の判断の理由（受けた・却下したとき） */
  humanReason?: string;
  /** 受けて外した明細（取り消すと戻す） */
  removed?: WorkDetailT[];
}

let removals: StarRemoval[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const notify = () => {
  removals = [...removals];
  for (const l of listeners) l();
};

/** 今の回の消す案（却下したものを除く）。案のままのものは、指す明細がまだ計画にあるものだけ */
export function starRemovals(): StarRemoval[] {
  const w = getWorkingPlan();
  if (!w) return [];
  const keys = new Set(w.plan.details.map((d) => d.detailKey));
  return removals.filter((r) => r.generation === w.generation && r.state !== "rejected" && (r.state === "accepted" || r.detailKeys.some((k) => keys.has(k))));
}
/** 却下した消す案（今の回） */
export function rejectedRemovals(): StarRemoval[] {
  const g = getWorkingPlan()?.generation;
  return removals.filter((r) => r.generation === g && r.state === "rejected");
}
/** 案のままの消す案の数（下の帯の「未確定」に足す） */
export const openRemovalCount = (): number => starRemovals().filter((r) => r.state === "proposed").length;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => removals;
/** 消す案が変わるたびに描き直す（中身は starRemovals() で読む） */
export function useStarRemovals(): readonly StarRemoval[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export type StarsOutcome =
  | { ok: true; placed: PlacedStar[]; removals: { id: string; workKey: string; value: StarValue; fiscalYear: number; details: number; already: boolean }[]; version: number }
  | { ok: false; code: TabSentCode };

/** 次の案の ID（計画の明細と消す案で使っていないもの） */
function nextId(used: Set<string>): string {
  let id: string;
  do id = `${STAR_PREFIX}${++seq}`;
  while (used.has(id));
  used.add(id);
  return id;
}

/** 確かめだけ（周期の案と一緒に来たとき、周期の案を置く前に断れるように） */
export function checkStarsFromAi(stars: readonly StarIn[], o: { author: "ai" | "ai_relayed_human"; verified: VerifiedBases; fromLedger: boolean; actualUpTo: number | null }): TabSentCode | null {
  const w = getWorkingPlan();
  if (!w) return null;
  const bad = checkStars(w.plan, stars, o);
  return bad ? SENT[bad.code] : null;
}

/**
 * AI の星取の案を置く。1 つでも合わなければ、どれも置かない。足す案は計画に作者 AI の明細を足し、消す案はここに置く。
 * basedOnVersion を照らすのは、呼ぶ側（周期の案と一緒なら、周期の案を置いたあとの版で呼ぶので照らさない：checkVersion false）
 */
export function proposeStarsFromAi(
  stars: readonly StarIn[],
  basedOnVersion: number,
  basis: string,
  o: { author: "ai" | "ai_relayed_human"; verified: VerifiedBases; fromLedger: boolean; actualUpTo: number | null; checkVersion?: boolean },
): StarsOutcome {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  if (o.checkVersion !== false && basedOnVersion !== working.revision) return { ok: false, code: "stale_version" };
  const bad = checkStars(working.plan, stars, o);
  if (bad) return { ok: false, code: SENT[bad.code] };
  const used = new Set<string>([...working.plan.details.map((d) => d.detailKey.split("-")[1] ?? ""), ...removals.map((r) => r.id)]);
  const adds = stars.filter((s) => s.op === "add");
  const r = proposeStars(working.plan, adds, { nextId: () => nextId(used), basis, author: o.author, verified: o.verified });
  const open = starRemovals().filter((x) => x.state === "proposed");
  const outRemovals: Extract<StarsOutcome, { ok: true }>["removals"] = [];
  const fresh: StarRemoval[] = [];
  for (const s of stars) {
    if (s.op !== "remove") continue;
    const wk = workKeyOfRef(s.rowRef)!;
    const same = [...open, ...fresh].find((x) => x.workKey === wk && x.value === s.value && x.fiscalYear === s.fiscalYear);
    if (same) {
      outRemovals.push({ id: same.id, workKey: wk, value: s.value, fiscalYear: s.fiscalYear, details: same.detailKeys.length, already: true });
      continue;
    }
    const id = nextId(used);
    const detailKeys = removalTargets(r.plan, wk, s.value, s.fiscalYear);
    fresh.push({ id, workKey: wk, value: s.value, fiscalYear: s.fiscalYear, detailKeys, basis: removalBasis(basis, id, s.value, s.fiscalYear), author: o.author, generation: working.generation, state: "proposed" });
    outRemovals.push({ id, workKey: wk, value: s.value, fiscalYear: s.fiscalYear, details: detailKeys.length, already: false });
  }
  const added = r.placed.some((p) => p.detailKey !== null);
  if (added) updateWorkingPlan(r.plan, working.proposals);
  if (fresh.length > 0) {
    removals = [...removals, ...fresh];
    notify();
  }
  return { ok: true, placed: r.placed, removals: outRemovals, version: getWorkingPlan()?.revision ?? working.revision };
}

// ─── 人の道（確定のシートだけが呼ぶ。AI のツールの受け手からは呼ばない） ─────────────

export type RemovalHumanOutcome = { ok: true; details: number } | { ok: false; reason: "notProposed" | "reasonEmpty" };

/** 人が消す案を受ける：指す明細を作業中の計画から外す（外した明細は取り消しのために覚える） */
export function acceptRemovalByHuman(id: string, reason: string): RemovalHumanOutcome {
  if (reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const working = getWorkingPlan();
  const r = starRemovals().find((x) => x.id === id && x.state === "proposed");
  if (!working || !r) return { ok: false, reason: "notProposed" };
  const keys = new Set(r.detailKeys);
  const removed = working.plan.details.filter((d) => keys.has(d.detailKey));
  if (removed.length === 0) return { ok: false, reason: "notProposed" };
  removals = removals.map((x) => (x.id === id ? { ...x, state: "accepted" as const, humanReason: reason.trim(), removed } : x));
  updateWorkingPlan({ ...working.plan, details: working.plan.details.filter((d) => !keys.has(d.detailKey)) }, working.proposals);
  notify();
  return { ok: true, details: removed.length };
}

/** 受けた消す案を取り消す：外した明細を戻し、案のままに戻す */
export function undoRemovalByHuman(id: string): boolean {
  const working = getWorkingPlan();
  const r = removals.find((x) => x.id === id && x.state === "accepted" && x.generation === working?.generation);
  if (!working || !r) return false;
  const have = new Set(working.plan.details.map((d) => d.detailKey));
  const back = (r.removed ?? []).filter((d) => !have.has(d.detailKey));
  removals = removals.map((x) => (x.id === id ? { ...x, state: "proposed" as const, removed: undefined, humanReason: undefined } : x));
  updateWorkingPlan({ ...working.plan, details: [...working.plan.details, ...back] }, working.proposals);
  notify();
  return true;
}

/** 人が消す案を却下する：計画は変えず、案を捨てる */
export function rejectRemovalByHuman(id: string, reason: string): RemovalHumanOutcome {
  if (reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const r = starRemovals().find((x) => x.id === id && x.state === "proposed");
  if (!r) return { ok: false, reason: "notProposed" };
  removals = removals.map((x) => (x.id === id ? { ...x, state: "rejected" as const, humanReason: reason.trim() } : x));
  notify();
  return { ok: true, details: 0 };
}

/** 試験用 */
export function resetStarsForTest(): void {
  removals = [];
  seq = 0;
  notify();
}
