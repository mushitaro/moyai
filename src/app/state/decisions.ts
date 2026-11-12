// MERGE の決定のシートで人が受けた決定（docs/screens.md 3.2「決定」・docs/plan.md §2.9）。署名のダイアログは、ここから受けた決定を読んで送る。
// 受けたのは、決定の ID と中身の指紋（hash）の組と、一言の理由。受けたあとに中身が変われば指紋が変わり、また受けていない決定になる。
// 正本はこのタブのメモリ（確定すると版の記録に入り、ここは空にする）。閉じたときに戻せるよう、写しを state/work.ts（施設ごとの作業中。#82） が書く。
import { useSyncExternalStore } from "react";
import type { Acceptance } from "../../plan/diff";

let accepted = new Map<string, Acceptance>();
const listeners = new Set<() => void>();
const notify = () => {
  accepted = new Map(accepted);
  for (const l of listeners) l();
};
const key = (id: string, hash: string) => `${id}\u0000${hash}`;

/** 人が画面で受ける（理由は 1 文字以上。空なら受けない） */
export function acceptDecision(id: string, hash: string, reason: string): boolean {
  const r = reason.trim();
  if (r.length === 0) return false;
  accepted.set(key(id, hash), { id, hash, reason: r });
  notify();
  return true;
}

export function unacceptDecision(id: string, hash: string): void {
  if (accepted.delete(key(id, hash))) notify();
}

export function clearAccepted(): void {
  if (accepted.size === 0) return;
  accepted.clear();
  notify();
}

export function isAccepted(id: string, hash: string): boolean {
  return accepted.has(key(id, hash));
}

/** 受けた決定の一覧（state/work.ts（施設ごとの作業中。#82） が写しに書く） */
export function acceptedList(): Acceptance[] {
  return [...accepted.values()];
}

/** 前の作業の写しから戻す（今の受けた決定は置き換える。理由が空のものは戻さない） */
export function restoreAccepted(list: readonly Acceptance[]): void {
  accepted = new Map();
  for (const a of list) if (a.reason.trim().length > 0) accepted.set(key(a.id, a.hash), { id: a.id, hash: a.hash, reason: a.reason.trim() });
  notify();
}

/** 受けた決定が変わるたびに呼ぶ（state/work.ts（施設ごとの作業中。#82）） */
export function subscribeAccepted(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 受けた決定のうち、今の受けていない決定（pending）に当たるものだけ */
export function acceptancesFor(pending: readonly { id: string; hash: string }[]): Acceptance[] {
  return pending.map((d) => accepted.get(key(d.id, d.hash))).filter((a): a is Acceptance => !!a);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => accepted;

/** 受けた決定（変わるたびに描き直す） */
export function useAccepted(): ReadonlyMap<string, Acceptance> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
