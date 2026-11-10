// 星取の案を作業中の計画に置く（AI の chart_propose の stars の受け手。src/plan/star.ts）。周期の案（state/cycles.ts）と同じく、
// AI のツールの受け手（intake/tab-tools.ts）は計画を直に書き換えず、この関数を通す。
// - 1 つの頼みで、同じ作業の同じ種類（計画の追加・計画の削除・計画の移動・実績の追加・実績の削除）は 1 つの案（S<n>）にまとめる。確定のシートでは 1 案 1 行。
// - 追加：作者が AI の明細を計画に足す（人が確定するまで未確定。受けた記録は state/decisions.ts）。
// - 削除：計画は変えず、ここ（このタブのメモリ）に置く。人が確定のシートで確定したときだけ、その明細を作業中の計画から外す（人の道）。
//   確定を取り消すと、外した明細を戻す。却下すると案を捨てる。置き直した回（generation）が変われば、前の回の案は出さない。
// - 移動：同じ案の中に、削除（元の年度）と追加（先の年度）を持つ。
import { useSyncExternalStore } from "react";
import { STAR_PREFIX, checkStars, proposalIdOf, proposeStars, removalBasis, removalTargets, starKindOf, workKeyOfRef, type StarAdd, type StarCode, type StarIn, type StarKind, type StarValue } from "../../plan/star";
import type { VerifiedBases } from "../../plan/cycle";
import type { WorkDetailT } from "../../shared/plan";
import type { TabSentCode } from "../../shared/errors";
import { removalHash, removalId, type Acceptance } from "../../plan/diff";
import { getWorkingPlan, updateWorkingPlan } from "./plan-store";
import { displayPrefs } from "./screen";

/** 星取の案の確かめの答え → AI に返す誤り（作業画面が送り手。src/shared/errors.ts） */
const SENT: Record<StarCode, TabSentCode> = {
  star_work_unknown: "star_work_unknown",
  star_out_of_range: "star_out_of_range",
  star_unknown: "star_unknown",
  star_basis_invalid: "star_basis_invalid",
};

/** 1 つの案（確定のシートの 1 行）。追加の明細は計画にあり、ここは種類・削除・移動の対・人の判断を持つ */
export interface StarGroup {
  id: string;
  kind: StarKind;
  workKey: string;
  value: StarValue;
  /** human は人の試し（星取表で人が未来の ○ を動かした。下の「人の試し」。AI のツールの受け手からは作らない） */
  author: "ai" | "ai_relayed_human" | "human";
  basis: string;
  generation: number;
  /** 削除する星取（計画の削除・実績の削除・計画の移動の元の年度） */
  removes: { fiscalYear: number; detailKeys: string[] }[];
  /** 計画の移動の対（元の年度 → 先の年度） */
  pairs: { from: number; to: number }[];
  /** 削除の人の判断（追加だけの案は proposed のまま。却下は追加の案にも付く） */
  state: "proposed" | "accepted" | "rejected";
  humanReason?: string;
  /** 確定して外した明細（取り消すと戻す） */
  removed?: WorkDetailT[];
  /** 却下したときの追加の年度（却下済みの行に出す。明細は計画から外れているため） */
  rejectedAdds?: number[];
}

let groups: StarGroup[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const notify = () => {
  groups = [...groups];
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => groups;
/** 星取の案が変わるたびに描き直す（中身は starGroups() で読む） */
export function useStarGroups(): readonly StarGroup[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 今の回の案（却下したものを除く） */
export function starGroups(): StarGroup[] {
  const g = getWorkingPlan()?.generation;
  return groups.filter((x) => x.generation === g && x.state !== "rejected");
}
export function starGroup(id: string): StarGroup | undefined {
  return starGroups().find((x) => x.id === id);
}
/** 却下した案（今の回） */
export function rejectedStarGroups(): StarGroup[] {
  const g = getWorkingPlan()?.generation;
  return groups.filter((x) => x.generation === g && x.state === "rejected");
}
/** 案のままの削除の案（指す明細がまだ計画にあるもの）。下の帯の「未確定」に足し、星取表に斜線を重ねる */
export function openRemovals(): StarGroup[] {
  const w = getWorkingPlan();
  if (!w) return [];
  const keys = new Set(w.plan.details.map((d) => d.detailKey));
  return starGroups().filter((x) => x.state === "proposed" && x.removes.some((r) => r.detailKeys.some((k) => keys.has(k))));
}
export const openRemovalCount = (): number => openRemovals().reduce((n, g) => n + g.removes.length, 0);

export type StarsOutcome =
  | { ok: true; results: { id: string; index: number; op: StarIn["op"]; placed: boolean; details: number; detailKeys: string[] }[]; version: number }
  | { ok: false; code: TabSentCode };

/** 確かめだけ（周期の案と一緒に来たとき、周期の案を置く前に断れるように） */
export function checkStarsFromAi(stars: readonly StarIn[], o: { author: "ai" | "ai_relayed_human"; verified: VerifiedBases; fromLedger: boolean; actualUpTo: number | null }): TabSentCode | null {
  const w = getWorkingPlan();
  if (!w) return null;
  const bad = checkStars(w.plan, stars, { ...o, lastFiscalYear: displayPrefs(w.plan.facility.facilityKey).lastFiscalYear });
  return bad ? SENT[bad.code] : null;
}

/**
 * AI の星取の案を置く。1 つでも合わなければ、どれも置かない。同じ作業の同じ種類は 1 つの案にまとめる。
 * 追加は計画に作者 AI の明細を足し、削除はここに置く。basedOnVersion を照らすのは checkVersion が false でないとき
 * （周期の案と一緒なら、周期の案を置いたあとの版で呼ぶので照らさない）
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
  // 範囲は星取表の列と同じ（施設の計画の最大年度まで）
  const bad = checkStars(working.plan, stars, { ...o, lastFiscalYear: displayPrefs(working.plan.facility.facilityKey).lastFiscalYear });
  if (bad) return { ok: false, code: SENT[bad.code] };
  // 案の ID：計画の明細と、ここの案で使っていないもの
  const used = new Set<string>([...working.plan.details.map((d) => proposalIdOf(d.detailKey) ?? ""), ...groups.map((g) => g.id)]);
  const nextId = () => {
    let id: string;
    do id = `${STAR_PREFIX}${++seq}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  // 同じ作業 × 同じ種類で 1 つの案
  const byKey = new Map<string, StarGroup>();
  const groupOf = (kind: StarKind, workKey: string, value: StarValue) => {
    const k = `${kind}\u0000${workKey}`;
    let g = byKey.get(k);
    if (!g) byKey.set(k, (g = { id: nextId(), kind, workKey, value, author: o.author, basis, generation: working.generation, removes: [], pairs: [], state: "proposed" }));
    return g;
  };
  // 同じ星取の削除が、もう案のままで置いてあれば足さない
  const pendingRemoval = (wk: string, v: StarValue, fy: number) => openRemovals().some((g) => g.workKey === wk && g.value === v && g.removes.some((r) => r.fiscalYear === fy));
  const adds: StarAdd[] = [];
  const plan = working.plan;
  const results: Extract<StarsOutcome, { ok: true }>["results"] = [];
  for (const [index, s] of stars.entries()) {
    const wk = workKeyOfRef(s.rowRef)!;
    const kind = starKindOf(s);
    const value: StarValue = s.op === "move" ? "plan" : s.value;
    const g = groupOf(kind, wk, value);
    let removed = 0;
    const keys: string[] = [];
    if (s.op === "remove" || s.op === "move") {
      const fy = s.op === "move" ? s.fromFiscalYear : s.fiscalYear;
      if (!pendingRemoval(wk, value, fy) && !g.removes.some((r) => r.fiscalYear === fy)) {
        const detailKeys = removalTargets(plan, wk, value, fy);
        g.removes.push({ fiscalYear: fy, detailKeys });
        removed = detailKeys.length;
        keys.push(...detailKeys);
      }
    }
    if (s.op === "move") g.pairs.push({ from: s.fromFiscalYear, to: s.fiscalYear });
    if (s.op === "add" || s.op === "move") adds.push({ id: g.id, kind, workKey: wk, value, fiscalYear: s.fiscalYear });
    results.push({ id: g.id, index, op: s.op, placed: removed > 0, details: removed, detailKeys: keys });
  }
  const r = proposeStars(plan, adds, { basis, author: o.author, verified: o.verified });
  // 追加の結果を、引数の順に results へ（追加は adds の順と同じ）
  let a = 0;
  for (const res of results) {
    if (res.op === "remove") continue;
    const p = r.placed[a++]!;
    if (p.detailKey) {
      res.placed = true;
      res.details += 1;
      res.detailKeys.push(p.detailKey);
    }
  }
  if (r.placed.some((p) => p.detailKey !== null)) updateWorkingPlan(r.plan, working.proposals);
  const fresh = [...byKey.values()]
    .filter((g) => g.removes.length > 0 || r.placed.some((p) => p.id === g.id && p.detailKey !== null))
    .map((g) => (g.removes.length > 0 ? { ...g, basis: removalBasis(basis, g.id, g.kind, g.removes.map((x) => x.fiscalYear)) } : g));
  if (fresh.length > 0) {
    groups = [...groups, ...fresh];
    notify();
  }
  return { ok: true, results, version: getWorkingPlan()?.revision ?? working.revision };
}

// ─── 人の道（確定のシートだけが呼ぶ。AI のツールの受け手からは呼ばない） ─────────────

export type StarHumanOutcome = { ok: true; details: number } | { ok: false; reason: "notProposed" | "reasonEmpty" };

/** 人が案の削除を確定する：指す明細を作業中の計画から外す（外した明細は取り消しのために覚える）。削除の無い案は何もしない */
export function acceptRemovalsByHuman(id: string, reason: string): StarHumanOutcome {
  if (reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const working = getWorkingPlan();
  const g = starGroup(id);
  if (!working || !g || g.state !== "proposed") return { ok: false, reason: "notProposed" };
  if (g.removes.length === 0) return { ok: true, details: 0 };
  const keys = new Set(g.removes.flatMap((r) => r.detailKeys));
  const removed = working.plan.details.filter((d) => keys.has(d.detailKey));
  if (removed.length === 0) return { ok: false, reason: "notProposed" };
  groups = groups.map((x) => (x.id === id && x.generation === working.generation ? { ...x, state: "accepted" as const, humanReason: reason.trim(), removed } : x));
  updateWorkingPlan({ ...working.plan, details: working.plan.details.filter((d) => !keys.has(d.detailKey)) }, working.proposals);
  notify();
  return { ok: true, details: removed.length };
}

/** 確定した削除を取り消す：外した明細を戻し、案のままに戻す */
export function undoRemovalsByHuman(id: string): boolean {
  const working = getWorkingPlan();
  const g = starGroup(id);
  if (!working || !g || g.state !== "accepted") return false;
  const have = new Set(working.plan.details.map((d) => d.detailKey));
  const back = (g.removed ?? []).filter((d) => !have.has(d.detailKey));
  groups = groups.map((x) => (x === g ? { ...x, state: "proposed" as const, removed: undefined, humanReason: undefined } : x));
  updateWorkingPlan({ ...working.plan, details: [...working.plan.details, ...back] }, working.proposals);
  notify();
  return true;
}

/**
 * 人が案を却下する：追加の明細を作業中の計画から外し、削除は捨てる（今の星取はそのまま）。
 * 前の版から写した追加（ここに案の覚えが無いもの）も、明細から種類を読んで却下済みに残す
 */
export function rejectStarGroupByHuman(id: string, reason: string, fallback?: { kind: StarKind; workKey: string; value: StarValue; author: StarGroup["author"]; basis: string }): StarHumanOutcome {
  if (reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const working = getWorkingPlan();
  if (!working) return { ok: false, reason: "notProposed" };
  const mine = working.plan.details.filter((d) => proposalIdOf(d.detailKey) === id);
  const g = starGroup(id);
  if ((!g || g.state !== "proposed") && mine.length === 0) return { ok: false, reason: "notProposed" };
  const base = g ?? (fallback ? { id, ...fallback, generation: working.generation, removes: [], pairs: [], state: "proposed" as const } : null);
  if (!base) return { ok: false, reason: "notProposed" };
  const rec: StarGroup = { ...base, state: "rejected", humanReason: reason.trim(), rejectedAdds: mine.map((d) => d.fiscalYear).sort((x, y) => x - y) };
  groups = [...groups.filter((x) => !(x.id === id && x.generation === working.generation)), rec];
  if (mine.length > 0) updateWorkingPlan({ ...working.plan, details: working.plan.details.filter((d) => proposalIdOf(d.detailKey) !== id) }, working.proposals);
  notify();
  return { ok: true, details: mine.length + (g?.removes.length ?? 0) };
}

/**
 * 確定した削除を、版の記録に入れる形にする（id「remove:<明細の鍵>」・消した明細の指紋・人の理由。作者は橋渡しが human にする。Architect の 70）。
 * 署名のダイアログが acceptances に足して送る
 */
export function removalAcceptances(): Acceptance[] {
  const out: Acceptance[] = [];
  for (const g of starGroups()) {
    // 人の試しは理由が無くても確定できる（止めない。理由は空のまま署名の内側に入る）
    if (g.state !== "accepted" || (!g.humanReason && g.author !== "human")) continue;
    for (const d of g.removed ?? []) out.push({ id: removalId(d.detailKey), hash: removalHash(d), reason: g.humanReason ?? "" });
  }
  return out;
}

// ─── 人の試し（時間の地図 2、mushitaro/moyai#32）：星取表で人が未来の ○ を別の年度へ動かす ─────────────
// 画面の人の操作だけが呼ぶ（AI のツールの受け手 intake/tab-tools.ts からは呼ばない。tests/unit/human-only.test.ts が見張る）。
// 動かした先は作者「人」の明細（人が受ける決定は要らない）、元の年度は人が確定した削除（理由は空のまま）。版は変えない（確定・署名は確定のシートと署名のダイアログで人がする）。
// 取り消し・やり直しは何度でも（このタブのメモリ）。

export type TrialOutcome = { ok: true; id: string } | { ok: false; reason: "noPlan" | "notPlanOnly" | "occupied" | "outOfRange" };
interface Trial {
  workKey: string;
  from: number;
  to: number;
}
let undoStack: { id: string; trial: Trial }[] = [];
let redoStack: Trial[] = [];

/** 動かせるか：その作業の計画だけ（実績の無い年度）・先の年度にその作業の計画が無い・範囲の中 */
export function canMoveStarByHuman(workKey: string, from: number, to: number, range: { min: number; max: number }): TrialOutcome | null {
  const working = getWorkingPlan();
  if (!working) return { ok: false, reason: "noPlan" };
  if (from === to || to < range.min || to > range.max) return { ok: false, reason: "outOfRange" };
  const ds = working.plan.details.filter((d) => d.workKey === workKey);
  const at = (fy: number) => ds.filter((d) => d.fiscalYear === fy);
  if (!at(from).some((d) => d.planOrActual === "plan") || at(from).some((d) => d.planOrActual === "actual")) return { ok: false, reason: "notPlanOnly" };
  if (at(to).some((d) => d.planOrActual === "plan")) return { ok: false, reason: "occupied" };
  return null;
}

function applyTrial(t: Trial, range: { min: number; max: number }): TrialOutcome {
  const bad = canMoveStarByHuman(t.workKey, t.from, t.to, range);
  if (bad) return bad;
  const working = getWorkingPlan()!;
  const used = new Set<string>([...working.plan.details.map((d) => proposalIdOf(d.detailKey) ?? ""), ...groups.map((g) => g.id)]);
  let id: string;
  do id = `${STAR_PREFIX}${++seq}`;
  while (used.has(id));
  const basis = removalBasis(TRIAL_BASIS, id, "planMove", [t.from]);
  const r = proposeStars(working.plan, [{ id, kind: "planMove", workKey: t.workKey, value: "plan", fiscalYear: t.to }], { basis: TRIAL_BASIS, author: "human", verified: {} });
  const removed = r.plan.details.filter((d) => d.workKey === t.workKey && d.planOrActual === "plan" && d.fiscalYear === t.from);
  const keys = new Set(removed.map((d) => d.detailKey));
  const g: StarGroup = { id, kind: "planMove", workKey: t.workKey, value: "plan", author: "human", basis, generation: working.generation, removes: [{ fiscalYear: t.from, detailKeys: [...keys] }], pairs: [{ from: t.from, to: t.to }], state: "accepted", humanReason: "", removed };
  updateWorkingPlan({ ...r.plan, details: r.plan.details.filter((d) => !keys.has(d.detailKey)) }, working.proposals);
  groups = [...groups, g];
  undoStack = [...undoStack, { id, trial: t }];
  notify();
  return { ok: true, id };
}

/** 人が未来の ○ を動かす（星取表のドラッグか Alt+← / Alt+→）。やり直しの列は捨てる */
export function moveStarByHuman(workKey: string, from: number, to: number, range: { min: number; max: number }): TrialOutcome {
  const r = applyTrial({ workKey, from, to }, range);
  if (r.ok) redoStack = [];
  return r;
}

/** 人の試しを 1 つ取り消す（Ctrl+Z）：先の年度の明細を外し、元の年度の明細を戻す。試しが無ければ false */
export function undoTrialByHuman(): boolean {
  const last = undoStack[undoStack.length - 1];
  const working = getWorkingPlan();
  if (!last || !working) return false;
  undoStack = undoStack.slice(0, -1);
  const g = starGroup(last.id);
  const have = new Set(working.plan.details.map((d) => d.detailKey));
  const back = (g?.removed ?? []).filter((d) => !have.has(d.detailKey));
  updateWorkingPlan({ ...working.plan, details: [...working.plan.details.filter((d) => proposalIdOf(d.detailKey) !== last.id), ...back] }, working.proposals);
  groups = groups.filter((x) => x.id !== last.id);
  redoStack = [...redoStack, last.trial];
  notify();
  return true;
}

/** 取り消した試しをやり直す（Ctrl+Shift+Z）。やり直せなければ false */
export function redoTrialByHuman(range: { min: number; max: number }): boolean {
  const t = redoStack[redoStack.length - 1];
  if (!t) return false;
  const r = applyTrial(t, range);
  redoStack = redoStack.slice(0, -1);
  return r.ok;
}

/** 人の試しの、動かす前の位置（星取表に薄い ○ を残す）：作業の鍵 → 元の年度 */
export function trialOrigins(): { id: string; workKey: string; from: number; to: number }[] {
  return groups.filter((g) => g.author === "human" && g.state === "accepted").flatMap((g) => g.pairs.map((p) => ({ id: g.id, workKey: g.workKey, from: p.from, to: p.to })));
}

const TRIAL_BASIS = "人の試し";

// ─── 次の版：確定した削除を、資料から読み直した計画でも外したままにする（Architect の 70） ─────────────

/** 版の履歴で確定した削除：明細の鍵 → 版と理由（確定のシートの「第 n 版と同じ」には出さない。資料のシートの行き先に出す。Wire） */
let removedInHistory = new Map<string, { version: number | null; reason: string }>();
/** どの計画の、どの版までの履歴を読んだか（読む前に作り直しが走ったら待たせる。Architect の 70 の残り） */
let historyOf: { planId: string; version: number } | null = null;
/** 履歴を読み終えるまで待たせた作り直し（読み終えたら 1 回だけ流す） */
let waiting: { planId: string; version: number; run: () => void } | null = null;

/** 版の履歴（橋渡しの状態の accepted）から、確定した削除を置く。planId と、読んだいちばん新しい版を添える */
export function setRemovedInHistory(planId: string, version: number, accepted: readonly Acceptance[]): void {
  const next = new Map<string, { version: number | null; reason: string }>();
  for (const a of accepted) if (a.id.startsWith("remove:")) next.set(a.id.slice("remove:".length), { version: a.version ?? null, reason: a.reason });
  removedInHistory = next;
  historyOf = { planId, version };
  flushWaiting();
}
/** 確定した直後：この版で送った削除を履歴に足す（橋渡しの状態を読み直す前に作り直しても外れるように）。前の版までの履歴を読んでいるときだけ、読んだ版を進める */
export function noteCommittedRemovals(planId: string, version: number, sent: readonly Acceptance[]): void {
  for (const a of sent) if (a.id.startsWith("remove:")) removedInHistory.set(a.id.slice("remove:".length), { version, reason: a.reason });
  if (version === 1 || (historyOf?.planId === planId && historyOf.version >= version - 1)) historyOf = { planId, version };
  flushWaiting();
}
/** その計画の、その版までの履歴を読んだか */
export function historyReady(planId: string, version: number): boolean {
  return historyOf !== null && historyOf.planId === planId && historyOf.version >= version;
}
/** 履歴を読み終えるまで作り直しを待たせる（新しいものが来れば、前に待たせたものは捨てる） */
export function waitForHistory(planId: string, version: number, run: () => void): void {
  waiting = { planId, version, run };
}
function flushWaiting(): void {
  const w = waiting;
  if (!w || !historyReady(w.planId, w.version)) return;
  waiting = null;
  w.run();
}
export function removedInHistoryOf(detailKey: string): { version: number | null; reason: string } | undefined {
  return removedInHistory.get(detailKey);
}
/** 外した星取の元のセル（資料・シート・セル → 版と理由。資料のシートの詳細に「削除（第 n 版）」と理由を出す。Wire） */
let removedCells = new Map<string, { version: number | null; reason: string }>();
const cellKeyOf = (file: string, sheet: string | null, cell: string) => `${file}\u0000${sheet ?? ""}\u0000${cell}`;
export function removedCellOf(file: string, sheet: string | null, cell: string): { version: number | null; reason: string } | undefined {
  return removedCells.get(cellKeyOf(file, sheet, cell));
}
/** 資料から作った計画から、版の履歴で人が確定して消した星取を外す（消したものが資料から戻らないように） */
export function dropRemovedInHistory<P extends { planId: string; details: readonly { detailKey: string; sources: readonly { file: string; sheet: string | null; cell: string | null }[] }[] }>(plan: P): P {
  removedCells = new Map();
  if (historyOf?.planId !== plan.planId || removedInHistory.size === 0 || !plan.details.some((d) => removedInHistory.has(d.detailKey))) return plan;
  for (const d of plan.details) {
    const r = removedInHistory.get(d.detailKey);
    if (r) for (const s of d.sources) if (s.cell) removedCells.set(cellKeyOf(s.file, s.sheet, s.cell), r);
  }
  return { ...plan, details: plan.details.filter((d) => !removedInHistory.has(d.detailKey)) };
}

/** 確定のシートを開いたときに選ぶ案（星取表の詳しくの「| 確定のシートで見る」。1 回だけ受け取る） */
let pick: string | null = null;
export function requestStarPick(id: string): void {
  pick = id;
  // 確定のシートが開いたままでも受け取れるように知らせる
  notify();
}
export function peekStarPick(): string | null {
  return pick;
}
export function clearStarPick(): void {
  pick = null;
}

/** 試験用 */
export function resetStarsForTest(): void {
  undoStack = [];
  redoStack = [];
  groups = [];
  removedInHistory = new Map();
  historyOf = null;
  waiting = null;
  seq = 0;
  pick = null;
  notify();
}
