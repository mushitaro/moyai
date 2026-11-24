// 業務システムとの連携の、作業画面の側の置き場（このタブのメモリだけ。運営者の判断 2026-11-16。絵は Wire Frame の ConnectSheet）。
// - オンとオフ・つなぎ先は橋渡しの作業画面の道（tabConnectState）から読む。キーは来ない。
// - 読む：作業画面の道（tabConnectRead）で読んだ作業の実績を、人が落とした資料と同じ道（workspace の addFiles）で入れる。
// - 書き込みの案：作業画面の道（tabConnectPlan）。保管先の確定・署名した最新の版と、今のつなぎ先の突合と差分（数とハッシュ）。
// - 送る：人だけの経路（connect_send）。鍵とカナリアは橋渡しが送る直前に確かめる。AI の道具からは呼ばない。
import { useSyncExternalStore } from "react";
import type { BridgeClient } from "../bridge-client";
import type { IntakeWorkspace } from "../intake/workspace";
import { ROUTES } from "../../shared/routes";
import type { ConnectMatchRow, ConnectTarget, EamCounts } from "../../shared/connect";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "../components/ConfirmDialog";

export type WriteGate = { needed: false } | { needed: true; ok: true } | { needed: true; ok: false; reason: string };
export type ConnectTargetView = ConnectTarget & { write: WriteGate };

export interface ConnectPlanView {
  targetId: string;
  planId: string;
  version: number;
  rows: ConnectMatchRow[];
  counts: { ok: number; one: number; diff: number; add: number; change: number };
  hash: string;
  write: WriteGate;
}

export interface ConnectView {
  /** 橋渡しから読んだか */
  loaded: boolean;
  enabled: boolean;
  available: boolean;
  fake: boolean;
  targets: ConnectTargetView[];
  chosen: string | null;
  read: { targetId: string; file: string; counts: EamCounts } | null;
  plan: ConnectPlanView | null;
  /** 書き込みの案を出せない理由（確定・署名した版が無い など。画面の言葉） */
  planBlocked: string | null;
  sent: { targetId: string; planId: string; version: number; applied: number } | null;
  error: string | null;
  busy: boolean;
}

let view: ConnectView = { loaded: false, enabled: false, available: false, fake: false, targets: [], chosen: null, read: null, plan: null, planBlocked: null, sent: null, error: null, busy: false };
const listeners = new Set<() => void>();
const set = (p: Partial<ConnectView>) => {
  view = { ...view, ...p };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function getConnect(): ConnectView {
  return view;
}
export function useConnectView(): ConnectView {
  return useSyncExternalStore(subscribe, () => view, () => view);
}
/** シートが並ぶか：オンで、つなぎ先があるとき */
export const connectShown = (v: ConnectView) => v.loaded && v.enabled && v.available && v.targets.length > 0;

const refusal = (reason: unknown) => HUMAN_TEXT.refused[typeof reason === "string" ? reason : ""] ?? HUMAN_TEXT.refused.unknownAction!;

/** オンとオフ・つなぎ先を読み直す（作業画面がつながったとき・設定を保存したとき） */
export async function loadConnect(client: BridgeClient): Promise<void> {
  const r = await client.workCall(ROUTES.tabConnectState.path, {});
  if (!r || r.ok !== true) return set({ loaded: true, enabled: false, available: false, targets: [] });
  const targets = (r.targets as ConnectTargetView[]) ?? [];
  const chosen = view.chosen && targets.some((t) => t.id === view.chosen) ? view.chosen : (targets[0]?.id ?? null);
  set({ loaded: true, enabled: r.enabled === true, available: r.available === true, fake: r.fake === true, targets, chosen });
}

export function chooseTarget(id: string): void {
  // 同じつなぎ先を選び直しても、読んだ差分を消さない（消すと、選びが変わらないので読み直しが走らず「差分を読んでいます」のまま止まる）
  if (id === view.chosen) return;
  if (view.targets.some((t) => t.id === id)) set({ chosen: id, plan: null, planBlocked: null, sent: null, error: null });
}

/** 使うつなぎ先（印が無ければ、選んでいるもの） */
function targetOf(id: string | undefined): ConnectTargetView | null {
  const t = view.targets.find((x) => x.id === (id ?? view.chosen));
  return t ?? null;
}

export type ReadOutcome = { ok: true; target: ConnectTargetView; file: string; counts: EamCounts } | { ok: false; why: "no_target" | "read_failed" | "same_name"; target: ConnectTargetView | null; file?: string };

/** 読む（人の「読む」と、AI の connect_read）：読んだ作業の実績を資料として入れる */
export async function readNow(client: BridgeClient, ws: IntakeWorkspace, targetId?: string): Promise<ReadOutcome> {
  const t = targetOf(targetId);
  if (!t) return { ok: false, why: "no_target", target: null };
  if (t.id !== view.chosen) chooseTarget(t.id);
  set({ busy: true, error: null });
  try {
    const r = await client.workCall(ROUTES.tabConnectRead.path, { targetId: t.id });
    if (!r || r.ok !== true || typeof r.base64 !== "string" || typeof r.name !== "string") {
      set({ error: refusal(r?.reason ?? "connectReadFailed") });
      return { ok: false, why: "read_failed", target: t };
    }
    const name = r.name;
    if (ws.fileNames.includes(name)) {
      set({ error: HUMAN_TEXT.connect.sameName(name) });
      return { ok: false, why: "same_name", target: t, file: name };
    }
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
    await ws.addFiles([{ name, size: bytes.length, bytes: async () => bytes }]);
    const counts = r.counts as EamCounts;
    set({ read: { targetId: t.id, file: name, counts } });
    return { ok: true, target: t, file: name, counts };
  } finally {
    set({ busy: false });
  }
}

export type PlanOutcome = { ok: true; plan: ConnectPlanView; target: ConnectTargetView } | { ok: false; why: "no_target" | "no_signed_version" | "read_failed"; target: ConnectTargetView | null };

/** 書き込みの案（シートを開いたときと、AI の connect_plan）：突合と差分を読み、シートに出す。書かない */
export async function planNow(client: BridgeClient, planId: string, targetId?: string): Promise<PlanOutcome> {
  const t = targetOf(targetId);
  if (!t) return { ok: false, why: "no_target", target: null };
  if (t.id !== view.chosen) chooseTarget(t.id);
  set({ busy: true });
  try {
    const r = await client.workCall(ROUTES.tabConnectPlan.path, { targetId: t.id, planId });
    if (!r || r.ok !== true) {
      const reason = typeof r?.reason === "string" ? r.reason : "connectReadFailed";
      const noSigned = reason === "connectNoSigned" || reason === "noRoot";
      set({ plan: null, planBlocked: noSigned ? HUMAN_TEXT.connect.noSigned : refusal(reason) });
      return { ok: false, why: noSigned ? "no_signed_version" : "read_failed", target: t };
    }
    const plan: ConnectPlanView = { targetId: t.id, planId, version: Number(r.version), rows: r.rows as ConnectMatchRow[], counts: r.counts as ConnectPlanView["counts"], hash: String(r.hash), write: r.write as WriteGate };
    // 送ったあとに版が進んだら、送った印は外す
    const sent = view.sent && view.sent.targetId === t.id && view.sent.planId === planId && view.sent.version === plan.version ? view.sent : null;
    set({ plan, planBlocked: null, sent });
    return { ok: true, plan, target: t };
  } finally {
    set({ busy: false });
  }
}

/** 送る（人が主ボタン「送る」を押したときだけ。人だけの経路） */
export async function sendNow(client: BridgeClient): Promise<void> {
  const p = view.plan;
  if (!p) return;
  set({ busy: true, error: null });
  try {
    const res = await client.callHuman("connect_send", ROUTES.connectSend.path, { targetId: p.targetId, planId: p.planId, version: p.version, hash: p.hash });
    const r = readHuman<{ ok: boolean; reason?: string; applied: number }>(res);
    if (!r.ok) return set({ error: r.message });
    set({ sent: { targetId: p.targetId, planId: p.planId, version: p.version, applied: r.body.applied } });
  } finally {
    set({ busy: false });
  }
  // 送ったあとの突合を読み直す（送った印は同じ版のあいだ残る）
  await planNow(client, p.planId, p.targetId);
}

/** 試験：置き場を初めに戻す */
export function resetConnect(): void {
  view = { loaded: false, enabled: false, available: false, fake: false, targets: [], chosen: null, read: null, plan: null, planBlocked: null, sent: null, error: null, busy: false };
}
