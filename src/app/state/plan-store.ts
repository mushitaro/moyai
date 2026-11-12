// 作業中の計画の正本（このタブのメモリ）。取り込みの画面が置き、星取表・確定・検問所が読む。
// 閉じたときに戻せるよう、写しを state/work.ts（施設ごとの作業中。#82）が保管先に書く。正本はここのまま。
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
  /**
   * 中身が保管先の版のままか（その版を開いた・確定した直後）。書き換えると false。
   * 閉じる前の知らせ（state/leave.ts）と、戻すための写し（state/work.ts（施設ごとの作業中。#82））は、false のときだけ「未確定の計画」と数える。
   */
  stored: boolean;
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
  const b = base !== undefined ? base : plan.version > 0 ? plan.version : kept;
  current = { plan, origin, revision: ++revision, generation: ++generation, proposals, base: b, stored: plan.version > 0 && b === plan.version };
  notify();
  return current;
}

/** 前の作業の写し（state/work.ts（施設ごとの作業中。#82））を戻す。戻したものは未確定の計画として扱う（保管先の版のままとは見なさない） */
export function restoreWorkingPlan(plan: Plan, origin: PlanOrigin, proposals: CrosswalkProposal[], base: number | null): WorkingPlan {
  current = { plan, origin, revision: ++revision, generation: ++generation, proposals, base, stored: false };
  notify();
  return current;
}

/** 置いた計画の中身を書き換える（同じ回のまま、版だけを増やす）。作業中の計画が無ければ何もしない */
export function updateWorkingPlan(plan: Plan, proposals: CrosswalkProposal[]): WorkingPlan | null {
  if (!current) return null;
  current = { ...current, plan, proposals, revision: ++revision, stored: false };
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

/** 作業中の計画が変わるたびに呼ぶ（計画ルールの案を出し直す。state/cycles.ts） */
export const subscribeWorkingPlan = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useWorkingPlan(): WorkingPlan | null {
  return useSyncExternalStore(subscribe, getWorkingPlan, getWorkingPlan);
}
