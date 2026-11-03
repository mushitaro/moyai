// 作業中の計画の正本（このタブのメモリだけ）。取り込みの画面が置き、星取表・確定・検問所が読む。
// 置けるのは取り込み（intake）と、開発用の見本（dev）だけ。確定した計画はファイルにあり、ここは作業中の 1 つだけを持つ。
import { useSyncExternalStore } from "react";
import type { Plan } from "../../shared/plan";

export type PlanOrigin = "intake" | "dev";

export interface WorkingPlan {
  plan: Plan;
  origin: PlanOrigin;
  /** 置き直すたびに 1 つ増える（AI の案が、どの版をもとにしたかを照らすため） */
  revision: number;
}

let current: WorkingPlan | null = null;
let revision = 0;
const listeners = new Set<() => void>();

export function setWorkingPlan(plan: Plan, origin: PlanOrigin): WorkingPlan {
  current = { plan, origin, revision: ++revision };
  for (const l of listeners) l();
  return current;
}

export function clearWorkingPlan(): void {
  current = null;
  for (const l of listeners) l();
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
