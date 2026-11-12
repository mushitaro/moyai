// 確定のシートの判断の履歴（#29 の残り：判断の履歴を星の詳細に並べる）。
// 保管先の版の記録にある、人が受けた決定（理由と版）を、計画ごとに持つ。HOSHITORI が版の状態（plan_status の accepted）を読んだら置く。
// 読むだけ（星取表の星の詳細が、その星の明細・作業・機器の決定を引く）。行の値は持たない（決定の ID と理由と版だけ）
import { useSyncExternalStore } from "react";
import type { Acceptance } from "../../plan/diff";

let planId: string | null = null;
let list: readonly Acceptance[] = [];
const listeners = new Set<() => void>();

/** 計画の版の記録にある、受けた決定（plan_status の accepted） */
export function setAcceptHistory(id: string, accepted: readonly Acceptance[]): void {
  if (planId === id && list === accepted) return;
  planId = id;
  list = accepted;
  for (const l of listeners) l();
}

/** その計画の、決定の ID に当たる過去の判断（版の古い順） */
export function acceptHistoryFor(id: string, ids: readonly string[]): { version: number; reason: string; id: string }[] {
  if (planId !== id) return [];
  const want = new Set(ids);
  return list
    .filter((a) => want.has(a.id) && typeof a.version === "number")
    .map((a) => ({ version: a.version!, reason: a.reason, id: a.id }))
    .sort((a, b) => a.version - b.version);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** 履歴が変わったら描き直す */
export function useAcceptHistory(): readonly Acceptance[] {
  return useSyncExternalStore(subscribe, () => list, () => list);
}
