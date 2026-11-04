// 作業中の計画の正本（このタブのメモリだけ）。取り込みの画面が置き、星取表・確定・検問所が読む。
// 置けるのは取り込み（intake）と、開発用の見本（dev）だけ。確定した計画はファイルにあり、ここは作業中の 1 つだけを持つ。
// 当てはめ（state/crosswalk.ts）は、置いた計画の中身を書き換える（AI の案と、人が受けた・断ったもの）。
import { useSyncExternalStore } from "react";
import type { CrosswalkProposal } from "../../plan/crosswalk";
import type { Plan } from "../../shared/plan";

export type PlanOrigin = "intake" | "dev";

export interface WorkingPlan {
  plan: Plan;
  origin: PlanOrigin;
  /** 中身が変わるたびに 1 つ増える（AI の案が、どの版をもとにしたかを照らすため） */
  revision: number;
  /** 置き直した回（取り込み・確定・見本で置き直すたびに増える。当てはめで中身が変わっても増えない） */
  generation: number;
  /** AI が置いた当てはめの規則の一覧（置き直すと空に戻る。取り込みで作り直したときは引き継いだ分） */
  proposals: CrosswalkProposal[];
  /**
   * この編集がもとにした保管先の版（無ければ null。docs/screens.md 4 の 6）。署名のダイアログはこれを「もとにした版」として送るので、
   * ほかの人がその後に版を足していれば、橋渡しが断る（黙って上書きしない）。
   */
  base: number | null;
}

let current: WorkingPlan | null = null;
let revision = 0;
let generation = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/**
 * 作業中の計画を置く。もとにした版（base）は、渡さなければ、保管先の版の中身ならその版の番号、
 * 同じ計画を取り込みで作り直したならそのままの値、新しい計画なら null。
 */
export function setWorkingPlan(plan: Plan, origin: PlanOrigin, proposals: CrosswalkProposal[] = [], base?: number | null): WorkingPlan {
  const kept = current && current.plan.planId === plan.planId ? current.base : null;
  current = { plan, origin, revision: ++revision, generation: ++generation, proposals, base: base !== undefined ? base : plan.version > 0 ? plan.version : kept };
  notify();
  return current;
}

/** 置いた計画の中身を書き換える（同じ回のまま、版だけを増やす）。作業中の計画が無ければ何もしない */
export function updateWorkingPlan(plan: Plan, proposals: CrosswalkProposal[]): WorkingPlan | null {
  if (!current) return null;
  current = { ...current, plan, proposals, revision: ++revision };
  notify();
  return current;
}

export function clearWorkingPlan(): void {
  current = null;
  notify();
}

export function getWorkingPlan(): WorkingPlan | null {
  return current;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useWorkingPlan(): WorkingPlan | null {
  return useSyncExternalStore(subscribe, getWorkingPlan, getWorkingPlan);
}
