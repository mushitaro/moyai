// 検査（docs/plan.md §2.4）：どれも純粋な関数で、同じ計画と同じ基準日（と同じ承認の記録）なら同じ結果を返す。
// 時刻を読まない・乱数を使わない・計画を書き換えない。AI はここを呼ばず、結果を読んで出典を添えて説明するだけ。
// 結果は met / notMet / notApplicable、根拠の数字、例（10 件まで）、件数、出典、水準、閾値の出どころ、確かめた度合い。
// 年度だけの印は年度の差で数える（根拠に「年度の粒度」と出す）。日付のある予定は、その日が基準日より前なら過ぎたとする。
// 承認による延長は、人の承認の記録（ExtensionApproval）があり、パックの延長の上限の内のときだけ認める。記録の無い延長は notMet。
// 承認の記録の置き場（人だけが書く画面）はまだ無いので、作業画面は空の一覧を渡す（未実装と画面に出す）。
import type { WorkAttribute } from "../shared/fields";
import type { AssetNodeT, Plan, WorkDetailT, WorkT } from "../shared/plan";
import { EXAMPLES_MAX } from "../shared/tools";
import type { CheckKind, CheckLevel, CheckParams, CheckSpec, LoadedChecks, ThresholdOrigin, VerificationLevel, WorkCondition } from "./spec";

export type CheckOutcome = "met" | "notMet" | "notApplicable";

/** notApplicable の理由 */
export type NotApplicableWhy = "noTargets" | "noPastPlans" | "noFuturePlans" | "noDetails" | "noValues";

/** 例の中身（どの外れか） */
export type ExampleWhy =
  | "gap" // 実施の間が閾値を越える
  | "gapToEnd" // 最後の実施から、基準日の年度か計画の最後の年度までが閾値を越える
  | "never" // 実施も今後の予定も無い
  | "extensionNotApproved" // 延長の上限の内だが、承認の記録が無い
  | "noActual" // 過ぎた予定に実績が無い
  | "noPlanInHorizon" // 計画の期間に予定が無い
  | "missingFields" // 決められた欄が空
  | "outOfScale" // 判定の値が尺度に無い
  | "noFollowup"; // 判定のあとに要る作業が無い

export interface CheckExample {
  /** 資産の節（無ければ null） */
  nodeKey: string | null;
  /** 作業（無ければ null） */
  workKey: string | null;
  /** かかわる年度（間なら前と後。前か後が無ければ 1 つ） */
  fiscalYears: number[];
  /** 年数（間の長さなど。無ければ null） */
  years: number | null;
  /** 空だった欄 */
  fields: string[];
  /** 判定の値など（無ければ null） */
  value: string | null;
  why: ExampleWhy;
}

/** 根拠の数字の名前（画面の言葉は app/text/review.ts）。missing.<欄> は空だった欄ごとの数 */
export type NumberKey =
  | "referenceFiscalYear"
  | "thresholdYears"
  | "extensionCapYears"
  | "examined"
  | "notMet"
  | "intervals"
  | "longestYears"
  | "approvedExtensions"
  | "fromFiscalYear"
  | "toFiscalYear"
  | "horizonYears"
  | "dateless"
  | `missing.${string}`;

export interface CheckResult {
  checkId: string;
  kind: CheckKind;
  name: string;
  what: string;
  result: CheckOutcome;
  notApplicable: NotApplicableWhy | null;
  /** 見た数（機器・予定・作業・記録のどれかで、種類ごとに決まる） */
  examined: number;
  /** 外れの数（例はこのうちの 10 件まで） */
  count: number;
  numbers: Partial<Record<NumberKey, number | null>>;
  examples: CheckExample[];
  level: CheckLevel;
  thresholdOrigin: ThresholdOrigin;
  source: { document: string; clause: string; page: string | null; url: string } | null;
  /** 出典の確かめた度合い。出典の無いアプリの目安は null */
  verification: VerificationLevel | null;
  unimplemented: string | null;
  note: string | null;
}

/** 人がした延長の承認（人だけの経路で書く。AI のツールには無い） */
export interface ExtensionApproval {
  checkId: string;
  nodeKey: string;
  /** 認めた間の年数の上限 */
  upToYears: number;
  author: "human";
  reason: string;
  approvedOn: string;
}

export interface CheckInput {
  plan: Plan;
  /** 基準日（YYYY-MM-DD。時刻帯の無い文字） */
  referenceDate: string;
  approvals: readonly ExtensionApproval[];
}

export interface CheckRun {
  packId: string;
  checksVersion: number;
  referenceDate: string;
  referenceFiscalYear: number;
  results: CheckResult[];
  notMade: { what: string; why: string }[];
}

// ─── 共通の道具 ────────────────────────────────────────────────

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const nf = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/** 日付の年度（年度の始まりの月から） */
export function fiscalYearOfDate(date: string, startMonth: number): number {
  const m = DATE.exec(date);
  if (!m) throw new Error("基準日の形でない");
  const y = Number(m[1]);
  return Number(m[2]) >= startMonth ? y : y - 1;
}

function conditionHits(c: WorkCondition, w: WorkT): boolean {
  const v = c.field === "work.kind" ? w.kind : w.attribute;
  if (v === null) return false;
  const s = nf(v);
  switch (c.op) {
    case "equals":
      return s === nf(c.values[0]!);
    case "in":
      return c.values.some((x) => s === nf(x));
    case "contains":
      return s.includes(nf(c.values[0]!));
    case "prefix":
      return s.startsWith(nf(c.values[0]!));
  }
}

/** 条件のすべてに当たる作業（条件が無ければ全部） */
const selectWorks = (plan: Plan, conds: WorkCondition[]) => plan.works.filter((w) => conds.every((c) => conditionHits(c, w)));

class PlanIndex {
  readonly assets: Map<string, AssetNodeT>;
  readonly works: Map<string, WorkT>;
  readonly detailsOf = new Map<string, WorkDetailT[]>();
  readonly children = new Map<string, string[]>();
  readonly order = new Map<string, number>();
  readonly refFy: number;
  /** 計画の最後の予定の年度（基準日の年度より前のものは数えない）。無ければ null */
  readonly horizonEnd: number | null;

  constructor(
    readonly plan: Plan,
    readonly referenceDate: string,
  ) {
    this.assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
    this.works = new Map(plan.works.map((w) => [w.workKey, w]));
    plan.assets.forEach((a, i) => this.order.set(a.nodeKey, i));
    for (const d of plan.details) this.detailsOf.set(d.workKey, [...(this.detailsOf.get(d.workKey) ?? []), d]);
    for (const a of plan.assets) if (a.parentKey) this.children.set(a.parentKey, [...(this.children.get(a.parentKey) ?? []), a.nodeKey]);
    this.refFy = fiscalYearOfDate(referenceDate, plan.facility.fiscalYearStartMonth);
    const ahead = plan.details.filter((d) => d.planOrActual === "plan" && !this.isPast(d)).map((d) => d.fiscalYear);
    this.horizonEnd = ahead.length ? Math.max(...ahead) : null;
  }

  /** 予定が過ぎたか：日付があればその日（終わりの日を先に）が基準日より前、無ければ年度が基準日の年度より前 */
  isPast(d: WorkDetailT): boolean {
    const day = d.endDate ?? d.startDate;
    if (day !== null && DATE.test(day)) return day < this.referenceDate;
    return d.fiscalYear < this.refFy;
  }

  /** 1 段目に当てて人が受けた機器（基準日までに撤去したものを除く） */
  mappedAssets(): AssetNodeT[] {
    return this.plan.assets.filter((a) => a.commonItem !== null && a.commonItemAccepted && !(a.removedOn !== null && a.removedOn <= this.referenceDate));
  }

  /** 節と、その下のすべての節 */
  subtree(nodeKey: string): Set<string> {
    const out = new Set<string>();
    const stack = [nodeKey];
    while (stack.length) {
      const k = stack.pop()!;
      if (out.has(k)) continue;
      out.add(k);
      stack.push(...(this.children.get(k) ?? []));
    }
    return out;
  }

  /** 節を対象にする作業明細（作業と組で） */
  detailsOnNodes(nodes: ReadonlySet<string>): { d: WorkDetailT; w: WorkT }[] {
    const out: { d: WorkDetailT; w: WorkT }[] = [];
    for (const w of this.plan.works) {
      if (!w.targets.some((t) => nodes.has(t))) continue;
      for (const d of this.detailsOf.get(w.workKey) ?? []) out.push({ d, w });
    }
    return out;
  }

  /** 並べるための節の順（計画の資産の順。計画に無ければ最後） */
  orderOf(nodeKey: string | null): number {
    return nodeKey === null ? -1 : (this.order.get(nodeKey) ?? this.plan.assets.length);
  }
}

/** 外れの一覧を、計画の資産の順 → 年度 → 鍵の順に並べ、10 件までにする（同じ計画なら同じ例） */
function examplesOf(ix: PlanIndex, all: CheckExample[]): CheckExample[] {
  const key = (e: CheckExample) => [String(ix.orderOf(e.nodeKey) + 1).padStart(8, "0"), String(e.fiscalYears[0] ?? 0).padStart(6, "0"), e.nodeKey ?? "", e.workKey ?? ""].join("");
  return [...all].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, EXAMPLES_MAX);
}

type Body = { notApplicable: NotApplicableWhy | null; examined: number; misses: CheckExample[]; numbers: CheckResult["numbers"] };
const notApplicable = (why: NotApplicableWhy, numbers: CheckResult["numbers"] = {}): Body => ({ notApplicable: why, examined: 0, misses: [], numbers });

const attributeFits = (a: WorkAttribute | null, b: WorkAttribute | null) => a === null || b === null || a === b;

// ─── 種類ごとの関数 ─────────────────────────────────────────────

type P<K extends CheckKind> = Extract<CheckParams, { kind: K }>;

function intervalMax(ix: PlanIndex, spec: CheckSpec, p: P<"interval_max">, approvals: readonly ExtensionApproval[]): Body {
  const works = selectWorks(ix.plan, p.works);
  const targets = [...new Set(works.flatMap((w) => w.targets))].sort();
  if (!targets.length) return notApplicable("noTargets", { thresholdYears: p.years });
  const misses: CheckExample[] = [];
  let intervals = 0;
  let longest = 0;
  let approved = 0;
  let dateless = 0;
  const end = Math.max(ix.refFy, ix.horizonEnd ?? ix.refFy);
  for (const t of targets) {
    // 実施した年度と、これからの予定の年度（過ぎた予定で実績の無いものは数えない）
    const fys = new Set<number>();
    for (const w of works.filter((x) => x.targets.includes(t)))
      for (const d of ix.detailsOf.get(w.workKey) ?? []) {
        if (d.planOrActual === "actual" || !ix.isPast(d)) fys.add(d.fiscalYear);
        if (d.startDate === null) dateless++;
      }
    const ys = [...fys].sort((a, b) => a - b);
    if (!ys.length) {
      misses.push({ nodeKey: t, workKey: null, fiscalYears: [], years: null, fields: [], value: null, why: "never" });
      continue;
    }
    const gaps: { from: number; to: number | null; years: number }[] = [];
    for (let i = 1; i < ys.length; i++) gaps.push({ from: ys[i - 1]!, to: ys[i]!, years: ys[i]! - ys[i - 1]! });
    const last = ys[ys.length - 1]!;
    if (end > last) gaps.push({ from: last, to: null, years: end - last });
    for (const g of gaps) {
      intervals++;
      longest = Math.max(longest, g.years);
      if (g.years <= p.years) continue;
      const ok = p.extensionCapYears !== null && g.years <= p.extensionCapYears && approvals.some((a) => a.author === "human" && a.checkId === spec.id && a.nodeKey === t && a.upToYears >= g.years && a.reason.trim() !== "");
      if (ok) {
        approved++;
        continue;
      }
      const inCap = p.extensionCapYears !== null && g.years <= p.extensionCapYears;
      misses.push({
        nodeKey: t,
        workKey: null,
        fiscalYears: g.to === null ? [g.from] : [g.from, g.to],
        years: g.years,
        fields: [],
        value: null,
        why: inCap ? "extensionNotApproved" : g.to === null ? "gapToEnd" : "gap",
      });
    }
  }
  return {
    notApplicable: null,
    examined: targets.length,
    misses,
    numbers: {
      thresholdYears: p.years,
      extensionCapYears: p.extensionCapYears,
      referenceFiscalYear: ix.refFy,
      toFiscalYear: end,
      longestYears: longest,
      approvedExtensions: approved,
      dateless,
      intervals,
    },
  };
}

function nextDue(ix: PlanIndex, p: P<"next_due">): Body {
  const works = selectWorks(ix.plan, p.works);
  const misses: CheckExample[] = [];
  let examined = 0;
  let dateless = 0;
  for (const w of works)
    for (const d of ix.detailsOf.get(w.workKey) ?? []) {
      if (d.planOrActual !== "plan" || !ix.isPast(d)) continue;
      if (d.startDate === null) dateless++;
      for (const t of w.targets) {
        examined++;
        // 同じ機器・同じ年度に、作業の属性が合う実績があれば、予定は実施された
        const done = ix.detailsOnNodes(new Set([t])).some((x) => x.d.planOrActual === "actual" && x.d.fiscalYear === d.fiscalYear && attributeFits(w.attribute, x.w.attribute));
        if (!done) misses.push({ nodeKey: t, workKey: w.workKey, fiscalYears: [d.fiscalYear], years: null, fields: [], value: d.startDate, why: "noActual" });
      }
    }
  if (!examined) return notApplicable("noPastPlans", { referenceFiscalYear: ix.refFy });
  return { notApplicable: null, examined, misses, numbers: { referenceFiscalYear: ix.refFy, dateless } };
}

function coverage(ix: PlanIndex): Body {
  const assets = ix.mappedAssets();
  if (!assets.length) return notApplicable("noTargets");
  if (ix.horizonEnd === null) return notApplicable("noFuturePlans", { referenceFiscalYear: ix.refFy });
  const misses: CheckExample[] = [];
  for (const a of assets) {
    const has = ix.detailsOnNodes(ix.subtree(a.nodeKey)).some(({ d }) => d.planOrActual === "plan" && !ix.isPast(d) && d.fiscalYear >= ix.refFy && d.fiscalYear <= ix.horizonEnd!);
    if (!has) misses.push({ nodeKey: a.nodeKey, workKey: null, fiscalYears: [ix.refFy, ix.horizonEnd], years: null, fields: [], value: null, why: "noPlanInHorizon" });
  }
  return { notApplicable: null, examined: assets.length, misses, numbers: { fromFiscalYear: ix.refFy, toFiscalYear: ix.horizonEnd } };
}

function planHorizon(ix: PlanIndex, p: P<"plan_horizon">): Body {
  if (!ix.plan.details.length) return notApplicable("noDetails", { thresholdYears: p.years });
  const horizon = ix.horizonEnd === null ? 0 : ix.horizonEnd - ix.refFy + 1;
  const misses: CheckExample[] =
    horizon >= p.years ? [] : [{ nodeKey: null, workKey: null, fiscalYears: ix.horizonEnd === null ? [] : [ix.refFy, ix.horizonEnd], years: horizon, fields: [], value: null, why: "noPlanInHorizon" }];
  return {
    notApplicable: null,
    examined: 1,
    misses,
    numbers: { thresholdYears: p.years, fromFiscalYear: ix.refFy, toFiscalYear: ix.horizonEnd, horizonYears: horizon },
  };
}

function planFields(ix: PlanIndex, p: P<"plan_fields">): Body {
  const nodes = new Set(ix.mappedAssets().flatMap((a) => [...ix.subtree(a.nodeKey)]));
  const works = ix.plan.works.filter((w) => w.targets.some((t) => nodes.has(t)));
  if (!works.length) return notApplicable("noTargets");
  const misses: CheckExample[] = [];
  const missing: Record<string, number> = Object.fromEntries(p.fields.map((f) => [`missing.work.${f}`, 0]));
  for (const w of works) {
    const empty = p.fields.filter((f) => w[f] === null || w[f] === undefined);
    for (const f of empty) missing[`missing.work.${f}`]!++;
    if (empty.length) {
      const target = w.targets.find((t) => nodes.has(t)) ?? null;
      const fys = [...new Set((ix.detailsOf.get(w.workKey) ?? []).map((d) => d.fiscalYear))].sort((a, b) => a - b);
      misses.push({ nodeKey: target, workKey: w.workKey, fiscalYears: fys.slice(0, 1), years: null, fields: empty.map((f) => `work.${f}`), value: null, why: "missingFields" });
    }
  }
  return { notApplicable: null, examined: works.length, misses, numbers: missing };
}

function recordFields(ix: PlanIndex, p: P<"record_fields">): Body {
  const works = selectWorks(ix.plan, p.works);
  const misses: CheckExample[] = [];
  const missing: Record<string, number> = Object.fromEntries(p.fields.map((f) => [`missing.workDetail.${f}`, 0]));
  let examined = 0;
  for (const w of works)
    for (const d of ix.detailsOf.get(w.workKey) ?? []) {
      if (p.of !== "both" && d.planOrActual !== p.of) continue;
      examined++;
      const empty = p.fields.filter((f) => d[f] === null || d[f] === "");
      for (const f of empty) missing[`missing.workDetail.${f}`]!++;
      if (empty.length)
        misses.push({ nodeKey: w.targets[0] ?? null, workKey: w.workKey, fiscalYears: [d.fiscalYear], years: null, fields: empty.map((f) => `workDetail.${f}`), value: null, why: "missingFields" });
    }
  if (!examined) return notApplicable("noDetails");
  return { notApplicable: null, examined, misses, numbers: missing };
}

/** 判定の値のある作業明細（尺度の名前は問わない。尺度で分けるのは呼ぶ側） */
function graded(ix: PlanIndex): { d: WorkDetailT; w: WorkT }[] {
  const out: { d: WorkDetailT; w: WorkT }[] = [];
  for (const d of ix.plan.details) {
    if (d.resultValue === null || d.resultValue.trim() === "") continue;
    const w = ix.works.get(d.workKey);
    if (w) out.push({ d, w });
  }
  return out;
}
const sameScale = (d: WorkDetailT, scale: string) => d.resultScale === null || nf(d.resultScale) === nf(scale);

function scaleValid(ix: PlanIndex, p: P<"scale_valid">): Body {
  const all = graded(ix);
  if (!all.length) return notApplicable("noValues");
  const allowed = new Set(p.values.map(nf));
  const misses: CheckExample[] = [];
  for (const { d, w } of all) {
    if (sameScale(d, p.scale) && allowed.has(nf(d.resultValue!))) continue;
    misses.push({ nodeKey: w.targets[0] ?? null, workKey: w.workKey, fiscalYears: [d.fiscalYear], years: null, fields: [], value: d.resultValue, why: "outOfScale" });
  }
  return { notApplicable: null, examined: all.length, misses, numbers: {} };
}

function followup(ix: PlanIndex, p: P<"followup">): Body {
  const all = graded(ix).filter(({ d }) => sameScale(d, p.scale));
  if (!all.length) return notApplicable("noValues");
  const misses: CheckExample[] = [];
  let examined = 0;
  for (const { d, w } of all) {
    const rule = p.rules.find((r) => r.values.some((v) => nf(v) === nf(d.resultValue!)));
    if (!rule) continue;
    for (const t of w.targets) {
      examined++;
      const after = ix.detailsOnNodes(ix.subtree(t)).some(
        (x) =>
          x.d.detailKey !== d.detailKey &&
          x.d.fiscalYear >= d.fiscalYear &&
          !(x.d.startDate !== null && d.startDate !== null && x.d.startDate < d.startDate) &&
          (x.d.step === "action" || (x.w.attribute !== null && rule.needs.includes(x.w.attribute))),
      );
      if (!after) misses.push({ nodeKey: t, workKey: w.workKey, fiscalYears: [d.fiscalYear], years: null, fields: [], value: d.resultValue, why: "noFollowup" });
    }
  }
  return { notApplicable: null, examined, misses, numbers: {} };
}

function body(ix: PlanIndex, spec: CheckSpec, approvals: readonly ExtensionApproval[]): Body {
  const p = spec.params;
  switch (p.kind) {
    case "interval_max":
      return intervalMax(ix, spec, p, approvals);
    case "next_due":
      return nextDue(ix, p);
    case "coverage":
      return coverage(ix);
    case "plan_horizon":
      return planHorizon(ix, p);
    case "plan_fields":
      return planFields(ix, p);
    case "record_fields":
      return recordFields(ix, p);
    case "scale_valid":
      return scaleValid(ix, p);
    case "followup":
      return followup(ix, p);
  }
}

/** 1 つの検査を走らせる */
export function runCheck(spec: CheckSpec, loaded: Extract<LoadedChecks, { ok: true }>, input: CheckInput, ix = new PlanIndex(input.plan, input.referenceDate)): CheckResult {
  const b = body(ix, spec, input.approvals);
  const src = spec.source ? loaded.sources.sources.find((s) => s.id === spec.source!.id) : undefined;
  const result: CheckOutcome = b.notApplicable ? "notApplicable" : b.misses.length ? "notMet" : "met";
  return {
    checkId: spec.id,
    kind: spec.params.kind,
    name: spec.name,
    what: spec.what,
    result,
    notApplicable: b.notApplicable,
    examined: b.examined,
    count: b.misses.length,
    numbers: { ...b.numbers, examined: b.examined, notMet: b.misses.length },
    examples: examplesOf(ix, b.misses),
    level: spec.level,
    thresholdOrigin: spec.thresholdOrigin,
    source: spec.source && src ? { document: src.name, clause: spec.source.clause, page: spec.source.page, url: src.url } : null,
    verification: src ? src.state : null,
    unimplemented: spec.unimplemented,
    note: spec.note,
  };
}

/** パックの検査をすべて走らせる（パックの順のまま） */
export function runChecks(loaded: Extract<LoadedChecks, { ok: true }>, input: CheckInput): CheckRun {
  const ix = new PlanIndex(input.plan, input.referenceDate);
  return {
    packId: loaded.checks.pack,
    checksVersion: loaded.checks.version,
    referenceDate: input.referenceDate,
    referenceFiscalYear: ix.refFy,
    results: loaded.checks.checks.map((c) => runCheck(c, loaded, input, ix)),
    notMade: loaded.checks.notMade,
  };
}

/** 例の節の道（名前の段の並び。表示の番号があれば名前に添える。同じ名前の機器が系列ごとにあっても見分けるため。画面とツールの結果が使う） */
export function nodePath(plan: Plan, nodeKey: string | null): string[] {
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const out: string[] = [];
  let k = nodeKey;
  for (let i = 0; k && i < 20; i++) {
    const a = byKey.get(k);
    if (!a) break;
    out.unshift(a.tag ? `${a.name}（${a.tag}）` : a.name);
    k = a.parentKey;
  }
  return out;
}
