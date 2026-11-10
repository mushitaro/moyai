// SHARE の画面の今の選び（このタブのメモリにだけ置く）。
// - 画面の選び：共有先と共有フォルダ。AI の share_preview は、SHARE の画面が開いていればこの選びで数える（画面と同じ数を返すため）。画面を閉じると消す。
// - Claude の置いた答え（2026-11-10、SHARE の引き算：画面に見え方の選びを置かない）：share_preview の answers・dest。
//   画面はこれを今の見え方の答え・共有先にして「- Claude の入力」を出すだけで、署名・送る・設定はしない。このタブの間だけ持つ（画面を閉じても残す）。
import { useSyncExternalStore } from "react";

export interface ShareAnswers {
  facility: Record<string, string | null>;
  inNationalTable: boolean | null;
}

export interface ShareChoice {
  planId: string;
  dest: "ring" | "ledger";
  ringId: string | null;
}

export interface ClaudeShare {
  planId: string;
  /** Claude が置いた共有先（置いていなければ null） */
  dest: "ring" | "ledger" | null;
  /** Claude が置いた見え方の答え（置いていなければ null） */
  answers: ShareAnswers | null;
  /** 共有先を置いた回数（同じ共有先をもう一度置いたときも、画面が人の切り替えのあとに置き直せるように） */
  destSeq: number;
}

let current: ShareChoice | null = null;
let claude: ClaudeShare | null = null;
const listeners = new Set<() => void>();

export function setShareChoice(c: ShareChoice | null): void {
  current = c;
}

export function getShareChoice(): ShareChoice | null {
  return current;
}

/**
 * Claude が置いた答えと共有先を重ねる（同じ計画なら、前に置いた軸は残し、新しく置いた軸で上書きする。ほかの計画の答えは捨てる）。
 * 画面の今の選びになるだけ（署名・送る・設定はしない）
 */
export function placeClaudeShare(planId: string, o: { dest?: "ring" | "ledger"; answers?: ShareAnswers }): ClaudeShare {
  if (!o.dest && !o.answers && claude && claude.planId === planId) return claude;
  const prev: ClaudeShare = claude && claude.planId === planId ? claude : { planId, dest: null, answers: null, destSeq: 0 };
  const answers = o.answers
    ? {
        facility: { ...(prev.answers?.facility ?? {}), ...o.answers.facility },
        inNationalTable: o.answers.inNationalTable ?? prev.answers?.inNationalTable ?? null,
      }
    : prev.answers;
  claude = { planId, dest: o.dest ?? prev.dest, answers, destSeq: prev.destSeq + (o.dest ? 1 : 0) };
  for (const l of listeners) l();
  return claude;
}

export function getClaudeShare(planId: string | null): ClaudeShare | null {
  return planId && claude && claude.planId === planId ? claude : null;
}

export function clearClaudeShare(): void {
  claude = null;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** SHARE の画面が Claude の置いた答えを読む */
export function useClaudeShare(planId: string | null): ClaudeShare | null {
  const c = useSyncExternalStore(subscribe, () => claude, () => claude);
  return planId && c && c.planId === planId ? c : null;
}
