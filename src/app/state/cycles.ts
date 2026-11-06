// 周期の案を作業中の計画に置く（AI の chart_propose の受け手。docs/plan.md §2.18.4）。当てはめの案（state/crosswalk.ts の proposeFromAi）と同じく、
// AI のツールの受け手（intake/tab-tools.ts）は計画を直に書き換えず、この関数を通す。置くのは作者が AI の計画の印だけで、受けるのは人（決定のシート）。
// 計画ルール（3 段目の Skill の planCycle。案 C、2026-11-06）は、当たる作業に周期の案（R）を出すだけ（work.trigger を直に書かない。Architect の 42 の 1）。
// R の案は前の版から写さず（carryFromBase は写さない）、作業中の計画か当てているルールが変わるたびに、そのときのルールの版から出し直す（42 の 4）。
import { activePlanRules, type LoadedReading, type PlanCycleRule } from "../../import/reading";
import { LEDGER_CYCLE_PREFIX, PLAN_RULE_CYCLE_PREFIX, PLAN_RULE_SOURCE, cycleIdOf, planRuleLine, planRuleStatus, proposeCycles, type CycleProposal, type VerifiedBases } from "../../plan/cycle";
import type { Plan, WorkT } from "../../shared/plan";
import type { Rule } from "../../shared/tools";
import { getWorkingPlan, subscribeWorkingPlan, updateWorkingPlan } from "./plan-store";
import { getCurrentReadings, subscribeCurrentReadings } from "./readings";

let seq = 0;

export type CyclesOutcome = { ok: true; plan: Plan; proposals: CycleProposal[]; version: number } | { ok: false; code: "no_working_plan" | "stale_version" | "tool_failed" };

export function proposeCyclesFromAi(
  rules: Rule[],
  basedOnVersion: number,
  basis: string,
  o: { fromLedger: boolean; author?: "ai" | "ai_relayed_human"; verified?: VerifiedBases } = { fromLedger: false },
): CyclesOutcome {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  if (basedOnVersion !== working.revision) return { ok: false, code: "stale_version" };
  // 台帳を照らした案は L、ほかは C の頭の ID（決定のシートの種類を分ける）
  const r = proposeCycles(working.plan, rules, {
    nextId: () => `${o.fromLedger ? LEDGER_CYCLE_PREFIX : "C"}${++seq}`,
    basis,
    fromLedger: o.fromLedger,
    ...(o.author ? { author: o.author } : {}),
    ...(o.verified ? { verified: o.verified } : {}),
  });
  if (!r.ok) return { ok: false, code: "tool_failed" };
  const next = updateWorkingPlan(r.plan, working.proposals);
  // 計画ルールの案が続けて出し直されると版が進むので、返す版は今の版（AI が次に置くときに合うように）
  return { ok: true, plan: getWorkingPlan()?.plan ?? r.plan, proposals: r.proposals, version: getWorkingPlan()?.revision ?? next?.revision ?? working.revision };
}

// ─── 計画ルール → 周期の案（R） ───────────────────────────────────

/** 計画ルールを、周期の案の規則の形にする（項目 × 属性の条件と、work.trigger の年数） */
export function cycleRuleOf(r: PlanCycleRule): Rule {
  return {
    when: [
      { field: "assetNode.commonItem", op: "equals", values: [r.commonItem] },
      { field: "work.attribute", op: "equals", values: [r.attribute] },
    ],
    set: { field: "work.trigger", value: r.years },
    reason: r.reason,
  };
}

/** 計画ルールが当たる作業：作業の属性を人が受け、対象の節のどれかの共通の設備項目を人が受けたもの */
export function acceptedFor(plan: Plan, r: PlanCycleRule): (w: WorkT) => boolean {
  const nodes = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  return (w) =>
    w.attribute === r.attribute &&
    w.attributeAccepted &&
    w.targets.some((t) => {
      const a = nodes.get(t);
      return !!a && a.commonItem === r.commonItem && a.commonItemAccepted;
    });
}

/** この回（作業中の計画の generation）に計画ルールから出した案：R の ID → ルールの鍵（名前・版・中身） */
let owned = new Map<string, { key: string; generation: number; name: string; ruleId: string }>();
let applying = false;
/**
 * 人が却下した R の案：ルールの鍵（名前・版・中身）× 作業。同じルールの版のあいだは、その作業に出し直さない（ルールの版が変われば鍵が変わるので出し直す。Wire、11-06）。
 * 覚えは作業画面の状態（このタブのメモリ）に置く。却下した案は版に入らず、署名するものが無いため（版の記録は署名した中身だけを持つ）
 */
let rejected = new Set<string>();
const rejectKey = (ruleKey: string, workKey: string) => `${ruleKey}\u0001${workKey}`;

/** 却下した周期の案（確定のシートの「却下済み」に出す。置き直した回のものだけ） */
export interface RejectedCycle {
  id: string;
  marks: number;
  basis: string;
  reason: string;
  generation: number;
}
let rejectedRows: RejectedCycle[] = [];

export function rejectedCycles(): RejectedCycle[] {
  const gen = getWorkingPlan()?.generation;
  return rejectedRows.filter((r) => r.generation === gen);
}

/**
 * 人が確定のシートで周期の案を却下する（人の道。AI のツールの受け手からは呼ばない）：その案の計画の印を作業中の計画から外す。
 * R の案は、ルールの鍵と作業の組を覚え、同じルールの版のあいだは出し直さない。L・C の案は外すだけ（AI はまた置ける）
 */
export function rejectCycleByHuman(id: string, reason: string): { ok: true; marks: number } | { ok: false; reason: "notProposed" | "reasonEmpty" } {
  if (reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const working = getWorkingPlan();
  const mine = working?.plan.details.filter((d) => cycleIdOf(d.detailKey) === id) ?? [];
  if (!working || mine.length === 0) return { ok: false, reason: "notProposed" };
  const o = owned.get(id);
  if (o) for (const d of mine) rejected.add(rejectKey(o.key, d.workKey));
  rejectedRows = [...rejectedRows, { id, marks: mine.length, basis: mine[0]!.basis ?? "", reason: reason.trim(), generation: working.generation }];
  updateWorkingPlan({ ...working.plan, details: working.plan.details.filter((d) => cycleIdOf(d.detailKey) !== id) }, working.proposals);
  return { ok: true, marks: mine.length };
}

/** 計画ルールの鍵：名前・版・ルールの中身（どれかが変わったら出し直す） */
const keyOf = (a: { from: { name: string; version: string }; rule: PlanCycleRule }) => `${a.from.name}\u0000${a.from.version}\u0000${JSON.stringify(a.rule)}`;

/**
 * 当てている計画ルールから、作業中の計画に周期の案（R）を出し直す。同じルールで同じ結果なら計画を書き換えない（何度呼んでもよい）。
 * 出し直すのはこの回に出した R の案だけ（保管先の版に入っている印・L・C の案には触らない）。変えたら true
 */
export function applyPlanRules(readings: readonly LoadedReading[] = getCurrentReadings().readings): boolean {
  const working = getWorkingPlan();
  if (!working || applying) return false;
  const gen = working.generation;
  const mine = new Map([...owned].filter(([, o]) => o.generation === gen));
  const byKey = new Map([...mine].map(([id, o]) => [o.key, id]));
  const isMine = (detailKey: string) => {
    const c = cycleIdOf(detailKey);
    return c !== null && mine.has(c);
  };
  const used = new Set(working.plan.details.map((d) => cycleIdOf(d.detailKey)).filter((x): x is string => x !== null));
  let plan: Plan = { ...working.plan, details: working.plan.details.filter((d) => !isMine(d.detailKey)) };
  const next = new Map<string, { key: string; generation: number; name: string; ruleId: string }>();
  for (const a of activePlanRules(readings)) {
    const key = keyOf(a);
    let id = byKey.get(key);
    if (!id) {
      let n = 0;
      do id = `${PLAN_RULE_CYCLE_PREFIX}${++n}`;
      while (used.has(id) || mine.has(id) || next.has(id));
    }
    const rid = id;
    const r = proposeCycles(plan, [cycleRuleOf(a.rule)], {
      nextId: () => rid,
      // 根拠の頭：ルールの名前・版・承認済みか未承認の下書きか・1 文
      basis: planRuleLine(a.from.name, a.from.version, planRuleStatus(a.from), a.rule.text),
      fromLedger: false,
      author: "ai",
      planRule: { name: a.from.name, ruleId: a.rule.id },
      onlyWorks: ((ok) => (w: WorkT) => ok(w) && !rejected.has(rejectKey(key, w.workKey)))(acceptedFor(plan, a.rule)),
    });
    if (!r.ok) continue;
    plan = r.plan;
    next.set(rid, { key, generation: gen, name: a.from.name, ruleId: a.rule.id });
  }
  const sig = (p: Plan, ids: ReadonlyMap<string, unknown>) =>
    JSON.stringify(
      p.details
        .filter((d) => {
          const c = cycleIdOf(d.detailKey);
          return c !== null && ids.has(c);
        })
        .map((d) => [d.detailKey, d.basis])
        .sort(),
    );
  const same = sig(working.plan, mine) === sig(plan, next) && [...mine.keys()].sort().join() === [...next.keys()].sort().join();
  owned = next;
  if (same) return false;
  applying = true;
  try {
    updateWorkingPlan(plan, working.proposals);
  } finally {
    applying = false;
  }
  return true;
}

/** 計画ルールごとに、作業中の計画に出した案の印の数（ルールのシートの件数） */
export function planRuleMarks(plan: Plan | null, name: string, ruleId: string): number {
  if (!plan) return 0;
  return plan.details.filter((d) => cycleIdOf(d.detailKey) !== null && d.sources.some((s) => s.file === PLAN_RULE_SOURCE && s.sheet === name && s.cell === ruleId)).length;
}

/** 計画ルールの項目と属性は当たるが、紐付け（項目か属性）をまだ人が確定していない作業の数（確定するまで R を出さない。Architect の 42 の答え 3） */
export function planRuleWaiting(plan: Plan | null, r: PlanCycleRule): number {
  if (!plan) return 0;
  const nodes = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const ok = acceptedFor(plan, r);
  return plan.works.filter((w) => w.attribute === r.attribute && w.targets.some((t) => nodes.get(t)?.commonItem === r.commonItem) && !ok(w)).length;
}

let watching = false;
/** 作業中の計画か当てているルールが変わるたびに、計画ルールの案を出し直す（App が 1 回だけ呼ぶ） */
export function watchPlanRules(): void {
  if (watching) return;
  watching = true;
  const run = () => {
    applyPlanRules();
  };
  subscribeWorkingPlan(run);
  subscribeCurrentReadings(run);
}

/** 試験用：この回に出した R の案の覚えを捨てる */
export function resetPlanRulesForTest(): void {
  owned = new Map();
  rejected = new Set();
  rejectedRows = [];
}
