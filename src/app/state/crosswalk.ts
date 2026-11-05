// 当てはめの、作業画面の側（このタブのメモリの作業中の計画に効かせる。計算は src/plan/crosswalk.ts）。
// AI の道：proposeFromAi（crosswalk_propose の受け手 intake/tab-tools.ts だけが呼ぶ）と、要約の crosswalkSurvey。
// 人の道：acceptByHuman・rejectByHuman・setByHuman（取り込みの画面の当てはめの欄だけが呼ぶ。AI のツールの受け手からは呼ばない）。
// 案は作者「AI」・人が受けていない。受けるのは人だけで、受けた行だけが星取表の共通の行と共有に入る。
import {
  acceptProposal,
  carryOverCrosswalk,
  type CarryOverReport,
  crosswalkSummary,
  heldRows,
  proposeCrosswalk,
  rejectProposal,
  setMappingByHuman,
  type CrosswalkResult,
  type CrosswalkTarget,
  type HumanOutcome,
} from "../../plan/crosswalk";
import type { ChartCatalog } from "../../plan/chart";
import { ENTITIES, WORK_ATTRIBUTES, type EntityId, type FieldRef } from "../../shared/fields";
import type { Plan } from "../../shared/plan";
import { SURVEY_TEXT_MAX, SURVEY_TOP_VALUES, type CrosswalkSurvey, type Rule } from "../../shared/tools";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { TEXT } from "../text";
import { getWorkingPlan, setWorkingPlan, updateWorkingPlan } from "./plan-store";
import { AMBIGUOUS_KEY_PREFIX } from "../../import/compose";

/** もとにした版（1C）：MERGE で版を開いたときに置く。作り直すと、その版の当てはめを「第 n 版と同じ」の案として並べる */
let base: { version: number; plan: Plan; crosswalk: readonly { rule: Rule; basis: string }[] } | null = null;
export function setCrosswalkBase(b: typeof base): void {
  base = b;
}
export function getCrosswalkBase(): typeof base {
  return base;
}

const T = TEXT.crosswalk;

/** 規則の ID の続き番号（このタブで 1 つ。計画を置き直しても戻さない＝根拠の文がぶつからない） */
let ruleSeq = 0;

export function itemCodesOf(catalog: ChartCatalog | null): Set<string> {
  return new Set(catalog ? catalog.items.keys() : []);
}

const quote = (v: string | number) => (v === "" ? T.empty : `「${v}」`);

function fieldLabel(ref: string): string {
  const [e, k] = ref.split(".") as [EntityId, string];
  const ent = ENTITIES[e] as { label: string; fields: Record<string, { label: string }> } | undefined;
  return ent ? `${ent.label}の${ent.fields[k]?.label ?? k}` : ref;
}

function condText(c: Rule["when"][number]): string {
  const f = fieldLabel(c.field);
  const [a, b] = c.values as [string | number, string | number | undefined];
  switch (c.op) {
    case "equals":
      return T.cond.equals(f, quote(a));
    case "in":
      return T.cond.in(f, c.values.map(quote).join("・"));
    case "contains":
      return T.cond.contains(f, quote(a));
    case "prefix":
      return T.cond.prefix(f, quote(a));
    case "range":
      return T.cond.range(f, String(a), String(b ?? ""));
  }
}

/** 置く値の画面の名前（1 段目の項目はパックの名前、作業の属性はパックの言い方） */
export function valueLabel(catalog: ChartCatalog | null, target: CrosswalkTarget, value: string): string {
  if (target === "assetNode") return T.toItem(catalog?.items.get(value)?.name ?? value, value);
  const labels = (catalog ?? emptyCatalog()).workLabels as Record<string, string>;
  return T.toAttr(labels[value] ?? value, value);
}

export function ruleBasis(catalog: ChartCatalog | null, ruleId: string, rule: Rule, target: CrosswalkTarget, value: string): string {
  return T.ruleBasis(ruleId, rule.when.map(condText).join(T.cond.and), valueLabel(catalog, target, value), rule.reason);
}

// ─── AI の道 ────────────────────────────────────────────────

export type AiProposeOutcome =
  | { ok: true; data: CrosswalkResult & { version: number }; placed: number }
  | { ok: false; code: "no_working_plan" | "stale_version" | "code_not_in_pack" | "tool_failed" };

/** AI の規則を作業中の計画に当て、案を置く（作者「AI」・人が受けていない）。返すのは数と行の参照だけ */
export function proposeFromAi(rules: Rule[], basedOnVersion: number): AiProposeOutcome {
  const working = getWorkingPlan();
  if (!working) return { ok: false, code: "no_working_plan" };
  if (basedOnVersion !== working.revision) return { ok: false, code: "stale_version" };
  const catalog = catalogFor(working.plan.packId);
  const r = proposeCrosswalk(working.plan, rules, {
    itemCodes: itemCodesOf(catalog),
    basedOnVersion,
    nextRuleId: () => T.ruleId(++ruleSeq),
    basisOf: (id, rule, target, value) => ruleBasis(catalog, id, rule, target, value),
  });
  if (!r.ok) return { ok: false, code: r.code === "code_not_in_pack" ? "code_not_in_pack" : "tool_failed" };
  const placed = r.proposals.reduce((n, p) => n + heldRows(r.plan, p).length, 0);
  const next = updateWorkingPlan(r.plan, [...working.proposals, ...r.proposals]);
  return { ok: true, data: { ...r.result, version: next?.revision ?? working.revision }, placed };
}

type Top = { value: string; count: number };
function summarize(field: FieldRef, values: (string | number | null)[]): { field: FieldRef; rows: number; distinct: number; top: Top[] } {
  const m = new Map<string, number>();
  for (const v of values) {
    const s = v === null ? "" : String(v);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  const top = [...m.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, SURVEY_TOP_VALUES)
    .map(([value, count]) => ({ value: value.slice(0, SURVEY_TEXT_MAX), count }));
  return { field, rows: values.length, distinct: m.size, top };
}

/** AI に渡す当てはめの要約（intake_survey の crosswalk）。行は写さず、欄ごとの要約と数だけ。作業中の計画が無ければ null */
export function crosswalkSurvey(): CrosswalkSurvey | null {
  const working = getWorkingPlan();
  if (!working) return null;
  const plan: Plan = working.plan;
  const catalog = catalogFor(plan.packId);
  const labels = (catalog ?? emptyCatalog()).workLabels;
  const s = crosswalkSummary(plan);
  return {
    version: working.revision,
    packId: plan.packId,
    items: catalog ? [...catalog.items.values()].sort((a, b) => a.order - b.order).map((i) => ({ code: i.code, name: i.name, system: catalog.systems.get(i.systemCode)?.name ?? i.systemCode })) : [],
    attributes: WORK_ATTRIBUTES.map((code) => ({ code, label: labels[code] })),
    fields: [
      summarize("assetNode.name", plan.assets.map((a) => a.name)),
      summarize("assetNode.level", plan.assets.map((a) => a.level)),
      summarize("assetNode.tag", plan.assets.map((a) => a.tag)),
      summarize("assetNode.series", plan.assets.map((a) => a.series)),
      summarize("work.kind", plan.works.map((w) => w.kind)),
    ],
    unmapped: { nodes: s.nodes.none, works: s.works.none, records: s.unmappedRecords },
    proposals: working.proposals.slice(-100).map((p) => ({ ruleId: p.ruleId, target: p.target, value: p.value, state: p.state, held: heldRows(plan, p).length })),
  };
}

// ─── 取り込みで計画を作り直したとき ──────────────────────────────────

/**
 * 取り込みが作った計画を作業中の計画に置く。前の作業中の計画が同じ計画（取り込みの、同じ計画の ID）なら、
 * その当てはめ（AI の案・人が受けた規則・人が直に当てた行）を引き継ぎ、引き継いだ数を返す。引き継ぐものが無ければ null。
 */
export function placeComposedPlan(next: Plan): CarryOverReport | null {
  const prev = getWorkingPlan();
  const same = prev !== null && prev.origin === "intake" && prev.plan.planId === next.planId;
  const b = base && base.plan.planId === next.planId ? base : null;
  const any =
    same &&
    (b !== null || prev.proposals.length > 0 || prev.plan.assets.some((a) => a.commonItem !== null) || prev.plan.works.some((w) => w.attribute !== null));
  if (!same || !any) {
    setWorkingPlan(next, "intake");
    return null;
  }
  const r = carryOverCrosswalk(
    prev.plan,
    prev.proposals,
    next,
    itemCodesOf(catalogFor(next.packId)),
    T.acceptedBasis,
    b ? { ...b, reason: T.sameAs(b.version), ambiguousPrefix: AMBIGUOUS_KEY_PREFIX } : null,
  );
  setWorkingPlan(r.plan, "intake", r.proposals);
  return r.report;
}

// ─── 人の道（画面だけが呼ぶ） ─────────────────────────────────────

/** 人が画面で規則を受ける。案のままの行を「人が受けた」にし、作者は AI のまま、根拠に人の理由を足す */
export function acceptByHuman(ruleId: string, reason: string): HumanOutcome {
  const working = getWorkingPlan();
  const p = working?.proposals.find((x) => x.ruleId === ruleId);
  if (!working || !p) return { ok: false, reason: "notProposed" };
  const r = acceptProposal(working.plan, p, reason, T.acceptedBasis);
  if (r.ok) updateWorkingPlan(r.plan, working.proposals.map((x) => (x === p ? { ...x, state: "accepted" as const, humanReason: reason.trim() } : x)));
  return r;
}

/** 人が画面で規則を断る。案のままの行から案を外す */
export function rejectByHuman(ruleId: string, reason: string): HumanOutcome {
  const working = getWorkingPlan();
  const p = working?.proposals.find((x) => x.ruleId === ruleId);
  if (!working || !p) return { ok: false, reason: "notProposed" };
  const r = rejectProposal(working.plan, p, reason);
  if (r.ok) updateWorkingPlan(r.plan, working.proposals.map((x) => (x === p ? { ...x, state: "rejected" as const, humanReason: reason.trim() } : x)));
  return r;
}

/** 人が画面で 1 つの行に直に当てる（作者「人」）。value が null なら外す */
export function setByHuman(target: CrosswalkTarget, key: string, value: string | null, reason: string): HumanOutcome {
  const working = getWorkingPlan();
  if (!working) return { ok: false, reason: "rowMissing" };
  const r = setMappingByHuman(working.plan, target, key, value, reason, itemCodesOf(catalogFor(working.plan.packId)), T.humanBasis);
  if (r.ok) updateWorkingPlan(r.plan, working.proposals);
  return r;
}
