// 当てはめ（docs/plan.md §2.1）：資産の節 → 1 段目の項目、作業 → 作業の属性。
// AI が置いた規則（欄 × 比べ方 × 値の組と置く値。形は src/shared/tools.ts の 1 か所）を作業中の計画の行に当て、案を置く。
// 案は、作者「AI」・人が受けていない・根拠は規則の文。人が画面で受けたものだけが決まった当てはめになり、星取表の共通の行と共有に入る。
// 受ける・断る・人が直に当てるは、画面だけが呼ぶ（AI のツールの受け手からは呼ばない。src/app/state/crosswalk.ts）。
// 純粋な TS（UI もネットも持たない）。画面の言葉（規則の文）は呼ぶ側が渡す。
import { WORK_ATTRIBUTES, type AuthorKind, type WorkAttribute } from "../shared/fields";
import type { AssetNodeT, Plan, WorkT } from "../shared/plan";
import { EXAMPLES_MAX, type Rule } from "../shared/tools";

/** 規則が置ける欄と、その欄を持つ物（資産の節か作業） */
export const CROSSWALK_SET_FIELDS = { "assetNode.commonItem": "assetNode", "work.attribute": "work" } as const;
export type CrosswalkTarget = (typeof CROSSWALK_SET_FIELDS)[keyof typeof CROSSWALK_SET_FIELDS];

export type ProposalState = "proposed" | "accepted" | "rejected";

/** AI が置いた規則 1 つ（このタブのメモリだけに持つ。行には根拠の文で結ぶ） */
export interface CrosswalkProposal {
  ruleId: string;
  target: CrosswalkTarget;
  value: string;
  /** 案を置いた行の根拠の文。受ける・断るときは、この文を持つ行を探す */
  basis: string;
  rule: Rule;
  /** AI がもとにした作業中の計画の版 */
  basedOnVersion: number;
  /** 置いたときに当てた行の数・ぶつかった行の数 */
  matched: number;
  conflicts: number;
  /** 置いたときに当てた行の参照（10 件まで） */
  examples: string[];
  state: ProposalState;
  /** 人が受けた・断ったときの一言の理由 */
  humanReason: string | null;
}

export interface CrosswalkExample {
  rowRef: string;
  before: string | null;
  after: string | null;
}

export interface CrosswalkResult {
  matched: number;
  conflicts: number;
  examples: CrosswalkExample[];
  unmapped: number;
  unmappedNodes: number;
  unmappedWorks: number;
  unmappedExamples: string[];
  rules: { ruleId: string; matched: number; conflicts: number }[];
}

export type ProposeOutcome =
  | { ok: true; plan: Plan; proposals: CrosswalkProposal[]; result: CrosswalkResult }
  | { ok: false; code: "code_not_in_pack" | "rule_invalid"; ruleIndex: number };

export interface ProposeOptions {
  /** この計画のパックの 1 段目の項目のコード */
  itemCodes: ReadonlySet<string>;
  basedOnVersion: number;
  /** 次の規則の ID を出す（置く順に呼ぶ） */
  nextRuleId: () => string;
  /** 規則の文（案の根拠になる） */
  basisOf: (ruleId: string, rule: Rule, target: CrosswalkTarget, value: string) => string;
}

// ─── 行の参照と、当てはめの読み書き ─────────────────────────────────

export const nodeRef = (nodeKey: string) => `n:${nodeKey}`;
export const workRef = (workKey: string) => `w:${workKey}`;

interface Mapping {
  value: string | null;
  author: AuthorKind | null;
  basis: string | null;
  accepted: boolean;
}

function nodeMapping(a: AssetNodeT): Mapping {
  return { value: a.commonItem, author: a.commonItemAuthor, basis: a.commonItemBasis, accepted: a.commonItemAccepted };
}
function workMapping(w: WorkT): Mapping {
  return { value: w.attribute, author: w.attributeAuthor, basis: w.attributeBasis, accepted: w.attributeAccepted };
}
function withNode(a: AssetNodeT, m: Mapping): AssetNodeT {
  return { ...a, commonItem: m.value, commonItemAuthor: m.author, commonItemBasis: m.basis, commonItemAccepted: m.accepted };
}
function withWork(w: WorkT, m: Mapping): WorkT {
  return { ...w, attribute: m.value as WorkAttribute | null, attributeAuthor: m.author, attributeBasis: m.basis, attributeAccepted: m.accepted };
}

/** 星取表の共通の行に入るか：資産の節の 1 段目の項目と作業の属性の両方を、人が受けている（入らなければ未当てはめの行） */
export function inCommonRows(a: AssetNodeT, w: WorkT): boolean {
  return a.commonItem !== null && a.commonItemAccepted && w.attribute !== null && w.attributeAccepted;
}

/** 規則が置く欄の物。置けない欄なら null */
export function targetOf(rule: Rule): CrosswalkTarget | null {
  return (CROSSWALK_SET_FIELDS as Record<string, CrosswalkTarget>)[rule.set.field] ?? null;
}

// ─── 条件の当てはめ ──────────────────────────────────────────

type Scalar = string | number;
const norm = (s: string) => s.normalize("NFKC");
const isNum = (v: Scalar) => typeof v === "number" || (v.trim() !== "" && Number.isFinite(Number(v)));

/** 欄の値（一覧の欄は要素ごと、仕様は「名前=値」、空と null は ""） */
function valuesOf(obj: object, key: string): Scalar[] {
  const v = (obj as Record<string, unknown>)[key];
  if (v === null || v === undefined) return [""];
  if (Array.isArray(v)) {
    if (v.length === 0) return [""];
    return v.map((x) => (typeof x === "object" && x !== null ? `${(x as { key?: unknown }).key ?? ""}=${(x as { value?: unknown }).value ?? ""}` : typeof x === "number" ? x : String(x)));
  }
  if (typeof v === "number" || typeof v === "string") return [v];
  if (typeof v === "boolean") return [String(v)];
  return [JSON.stringify(v)];
}

function equal(a: Scalar, b: Scalar): boolean {
  if (typeof a === "number" || typeof b === "number") return isNum(a) && isNum(b) && Number(a) === Number(b);
  return norm(a) === norm(b);
}

/** 1 つの条件が、欄の値のどれかに当たるか。文字は全角・半角をそろえて（NFKC）比べる */
function hits(c: Rule["when"][number], vals: Scalar[]): boolean {
  const [x, y] = c.values as [Scalar, Scalar | undefined];
  return vals.some((v) => {
    switch (c.op) {
      case "equals":
        return equal(v, x);
      case "in":
        return c.values.some((w) => equal(v, w));
      case "contains":
        return norm(String(v)).includes(norm(String(x)));
      case "prefix":
        return norm(String(v)).startsWith(norm(String(x)));
      case "range": {
        if (y === undefined) return false;
        if (isNum(v) && isNum(x) && isNum(y)) return Number(x) <= Number(v) && Number(v) <= Number(y);
        const s = norm(String(v));
        return s !== "" && norm(String(x)) <= s && s <= norm(String(y));
      }
    }
  });
}

interface Index {
  assets: Map<string, AssetNodeT>;
  worksOf: Map<string, WorkT[]>;
}

function indexOf(plan: Plan): Index {
  const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const worksOf = new Map<string, WorkT[]>();
  for (const w of plan.works) for (const t of w.targets) worksOf.set(t, [...(worksOf.get(t) ?? []), w]);
  return { assets, worksOf };
}

const entityOf = (field: string) => field.slice(0, field.indexOf("."));
const keyOf = (field: string) => field.slice(field.indexOf(".") + 1);

/**
 * 規則の条件がすべて当たるか。欄が置く物と同じ物のものはその行の値で、もう一方の物のものは結んだ行で見る：
 * 資産の節の規則の作業の欄は「この節を対象にする作業のどれか」、作業の規則の資産の節の欄は「作業の対象の節のどれか」。
 */
function ruleHitsNode(rule: Rule, a: AssetNodeT, ix: Index): boolean {
  return rule.when.every((c) => {
    const e = entityOf(c.field);
    if (e === "assetNode") return hits(c, valuesOf(a, keyOf(c.field)));
    if (e === "work") return (ix.worksOf.get(a.nodeKey) ?? []).some((w) => hits(c, valuesOf(w, keyOf(c.field))));
    return false;
  });
}

function ruleHitsWork(rule: Rule, w: WorkT, ix: Index): boolean {
  return rule.when.every((c) => {
    const e = entityOf(c.field);
    if (e === "work") return hits(c, valuesOf(w, keyOf(c.field)));
    if (e === "assetNode")
      return w.targets.some((t) => {
        const a = ix.assets.get(t);
        return !!a && hits(c, valuesOf(a, keyOf(c.field)));
      });
    return false;
  });
}

/** 規則の条件がすべて当たる作業（周期の案など、作業に置く規則が使う） */
export function worksHitBy(plan: Plan, rule: Rule): WorkT[] {
  const ix = indexOf(plan);
  return plan.works.filter((w) => ruleHitsWork(rule, w, ix));
}

/** 規則が置く値として正しいか（作業の属性は 4 つのどれか、1 段目の項目はパックのコード） */
function valueProblem(rule: Rule, itemCodes: ReadonlySet<string>): "code_not_in_pack" | "rule_invalid" | null {
  const target = targetOf(rule);
  if (target === null) return "rule_invalid";
  if (rule.when.some((c) => entityOf(c.field) !== "assetNode" && entityOf(c.field) !== "work")) return "rule_invalid";
  const v = rule.set.value;
  if (typeof v !== "string") return "rule_invalid";
  if (target === "work") return (WORK_ATTRIBUTES as readonly string[]).includes(v) ? null : "rule_invalid";
  return itemCodes.has(v) ? null : "code_not_in_pack";
}

// ─── 未当てはめを数える ─────────────────────────────────────────

export interface CrosswalkSummary {
  /** 作業の対象になっている資産の節（案も当てはめも無い・案のまま・人が受けた） */
  nodes: { targeted: number; none: number; proposed: number; accepted: number };
  works: { total: number; none: number; proposed: number; accepted: number };
  /** 星取表の共通の行に入らず、未当てはめの行に入る記録（作業明細）の数 */
  unmappedRecords: number;
}

function targetedNodes(plan: Plan): AssetNodeT[] {
  const t = new Set(plan.works.flatMap((w) => w.targets));
  return plan.assets.filter((a) => t.has(a.nodeKey));
}

export function crosswalkSummary(plan: Plan): CrosswalkSummary {
  const count = (ms: Mapping[]) => ({
    none: ms.filter((m) => m.value === null).length,
    proposed: ms.filter((m) => m.value !== null && !m.accepted).length,
    accepted: ms.filter((m) => m.value !== null && m.accepted).length,
  });
  const nodes = targetedNodes(plan).map(nodeMapping);
  const works = plan.works.map(workMapping);
  const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const wmap = new Map(plan.works.map((w) => [w.workKey, w]));
  let unmappedRecords = 0;
  for (const d of plan.details) {
    const w = wmap.get(d.workKey);
    if (!w) continue;
    if (w.targets.some((t) => {
      const a = assets.get(t);
      return !!a && !inCommonRows(a, w);
    }))
      unmappedRecords++;
  }
  return { nodes: { targeted: nodes.length, ...count(nodes) }, works: { total: works.length, ...count(works) }, unmappedRecords };
}

function unmappedRows(plan: Plan): { nodes: string[]; works: string[] } {
  return {
    nodes: targetedNodes(plan).filter((a) => a.commonItem === null).map((a) => nodeRef(a.nodeKey)),
    works: plan.works.filter((w) => w.attribute === null).map((w) => workRef(w.workKey)),
  };
}

// ─── 案を置く（AI のツールの受け手が呼ぶ） ─────────────────────────────

interface Row {
  ref: string;
  target: CrosswalkTarget;
  key: string;
  current: Mapping;
}

/**
 * 規則を行に当て、案を置く。どの規則も、この呼び出しの前の計画の値で当てる（規則の順で結果が変わらない）。
 * 1 つでも置けない値（パックに無いコード・4 つの外の属性）があれば、どれも置かない。
 * ぶつかり：同じ行に違う値を置く規則が 2 つ以上当たった、または行がもう違う値を持つ（前の案か、人が受けたもの）。ぶつかった行は変えない。
 * 同じ値をもう持つ行は「当てた」に数え、変えない（前の案の根拠のまま）。値の無い行にだけ、最初に当たった規則の案を置く。
 */
export function proposeCrosswalk(plan: Plan, rules: Rule[], opts: ProposeOptions): ProposeOutcome {
  for (const [i, r] of rules.entries()) {
    const p = valueProblem(r, opts.itemCodes);
    if (p) return { ok: false, code: p, ruleIndex: i };
  }
  const ix = indexOf(plan);
  const rows: Row[] = [
    ...plan.assets.map((a) => ({ ref: nodeRef(a.nodeKey), target: "assetNode" as const, key: a.nodeKey, current: nodeMapping(a) })),
    ...plan.works.map((w) => ({ ref: workRef(w.workKey), target: "work" as const, key: w.workKey, current: workMapping(w) })),
  ];
  const ids = rules.map(() => opts.nextRuleId());
  const values = rules.map((r) => String(r.set.value));
  const targets = rules.map((r) => targetOf(r) as CrosswalkTarget);
  const hitBy = new Map<string, number[]>();
  for (const [i, r] of rules.entries()) {
    if (targets[i] === "assetNode") {
      for (const a of plan.assets) if (ruleHitsNode(r, a, ix)) hitBy.set(nodeRef(a.nodeKey), [...(hitBy.get(nodeRef(a.nodeKey)) ?? []), i]);
    } else for (const w of plan.works) if (ruleHitsWork(r, w, ix)) hitBy.set(workRef(w.workKey), [...(hitBy.get(workRef(w.workKey)) ?? []), i]);
  }

  const perRule = rules.map(() => ({ matched: 0, conflicts: 0, examples: [] as string[] }));
  const placed = new Map<string, Mapping>();
  const matchedRows: CrosswalkExample[] = [];
  const conflictRows: CrosswalkExample[] = [];
  const basisCache = new Map<number, string>();
  const basisOf = (i: number) => {
    if (!basisCache.has(i)) basisCache.set(i, opts.basisOf(ids[i]!, rules[i]!, targets[i]!, values[i]!));
    return basisCache.get(i)!;
  };
  for (const row of rows) {
    const by = hitBy.get(row.ref);
    if (!by) continue;
    const vs = [...new Set(by.map((i) => values[i]!))];
    const cur = row.current.value;
    const conflict = vs.length > 1 || (cur !== null && cur !== vs[0]);
    for (const i of by) {
      const pr = perRule[i]!;
      if (conflict) pr.conflicts++;
      else {
        pr.matched++;
        if (pr.examples.length < EXAMPLES_MAX) pr.examples.push(row.ref);
      }
    }
    if (conflict) {
      conflictRows.push({ rowRef: row.ref, before: cur, after: vs.join("|") });
      continue;
    }
    matchedRows.push({ rowRef: row.ref, before: cur, after: vs[0]! });
    if (cur === null) placed.set(row.ref, { value: vs[0]!, author: "ai", basis: basisOf(by[0]!), accepted: false });
  }

  const next: Plan = {
    ...plan,
    assets: plan.assets.map((a) => {
      const m = placed.get(nodeRef(a.nodeKey));
      return m ? withNode(a, m) : a;
    }),
    works: plan.works.map((w) => {
      const m = placed.get(workRef(w.workKey));
      return m ? withWork(w, m) : w;
    }),
  };
  const proposals: CrosswalkProposal[] = rules.map((r, i) => ({
    ruleId: ids[i]!,
    target: targets[i]!,
    value: values[i]!,
    basis: basisOf(i),
    rule: r,
    basedOnVersion: opts.basedOnVersion,
    matched: perRule[i]!.matched,
    conflicts: perRule[i]!.conflicts,
    examples: perRule[i]!.examples,
    state: "proposed",
    humanReason: null,
  }));
  const un = unmappedRows(next);
  // 例は 10 件まで：ぶつかった行を半分まで先に、残りを当てた行で埋め、まだ空きがあればぶつかった行の続き
  const half = Math.ceil(EXAMPLES_MAX / 2);
  const examples = [...conflictRows.slice(0, half)];
  examples.push(...matchedRows.slice(0, EXAMPLES_MAX - examples.length));
  examples.push(...conflictRows.slice(half, half + EXAMPLES_MAX - examples.length));
  return {
    ok: true,
    plan: next,
    proposals,
    result: {
      matched: matchedRows.length,
      conflicts: conflictRows.length,
      examples,
      unmapped: un.nodes.length + un.works.length,
      unmappedNodes: un.nodes.length,
      unmappedWorks: un.works.length,
      unmappedExamples: [...un.nodes, ...un.works].slice(0, EXAMPLES_MAX),
      rules: perRule.map((p, i) => ({ ruleId: ids[i]!, matched: p.matched, conflicts: p.conflicts })),
    },
  };
}

// ─── 人が受ける・断る・直に当てる（画面だけが呼ぶ） ───────────────────────────

/** 今もこの規則の案のままの行（人が受けていない・値と根拠が規則のまま） */
export function heldRows(plan: Plan, p: Pick<CrosswalkProposal, "target" | "value" | "basis">): string[] {
  const held = (m: Mapping) => m.author === "ai" && !m.accepted && m.value === p.value && m.basis === p.basis;
  return p.target === "assetNode"
    ? plan.assets.filter((a) => held(nodeMapping(a))).map((a) => nodeRef(a.nodeKey))
    : plan.works.filter((w) => held(workMapping(w))).map((w) => workRef(w.workKey));
}

export type HumanOutcome = { ok: true; plan: Plan; rows: number } | { ok: false; reason: "reasonEmpty" | "notProposed" | "rowMissing" | "valueInvalid" };

function rewrite(plan: Plan, target: CrosswalkTarget, refs: ReadonlySet<string>, f: (m: Mapping) => Mapping): Plan {
  return target === "assetNode"
    ? { ...plan, assets: plan.assets.map((a) => (refs.has(nodeRef(a.nodeKey)) ? withNode(a, f(nodeMapping(a))) : a)) }
    : { ...plan, works: plan.works.map((w) => (refs.has(workRef(w.workKey)) ? withWork(w, f(workMapping(w))) : w)) };
}

/** 人が規則を受ける：案のままの行を「人が受けた」にする。作者は AI のまま残し、根拠に人の理由を足す */
export function acceptProposal(plan: Plan, p: CrosswalkProposal, reason: string, acceptedBasis: (basis: string, reason: string) => string): HumanOutcome {
  if (reason.trim() === "") return { ok: false, reason: "reasonEmpty" };
  if (p.state !== "proposed") return { ok: false, reason: "notProposed" };
  const refs = new Set(heldRows(plan, p));
  const basis = acceptedBasis(p.basis, reason.trim());
  return { ok: true, plan: rewrite(plan, p.target, refs, (m) => ({ ...m, basis, accepted: true })), rows: refs.size };
}

/** 人が規則を断る：案のままの行から案を外す（値の無い行に戻す） */
export function rejectProposal(plan: Plan, p: CrosswalkProposal, reason: string): HumanOutcome {
  if (reason.trim() === "") return { ok: false, reason: "reasonEmpty" };
  if (p.state !== "proposed") return { ok: false, reason: "notProposed" };
  const refs = new Set(heldRows(plan, p));
  return { ok: true, plan: rewrite(plan, p.target, refs, () => ({ value: null, author: null, basis: null, accepted: false })), rows: refs.size };
}

// ─── 計画を作り直したときに引き継ぐ ──────────────────────────────────

export interface CarryOverReport {
  /** 引き継いだ規則（断った規則は引き継がない） */
  rules: number;
  /** 前の計画で人が受けていた当てはめの数（資産の節と作業） */
  acceptedBefore: number;
  /** 新しい計画で、引き継いで人が受けた当てはめの数 */
  acceptedAfter: number;
  /** 人が直に当てた行のうち、新しい計画に同じ行が無く引き継げなかった数 */
  humanLost: number;
}

const acceptedCount = (plan: Plan) =>
  plan.assets.filter((a) => a.commonItem !== null && a.commonItemAccepted).length + plan.works.filter((w) => w.attribute !== null && w.attributeAccepted).length;

/**
 * 取り込みで計画を作り直したとき、前の計画の当てはめを新しい計画に引き継ぐ（人の判断を黙って捨てない）。
 * 1. 人が直に当てた行（作者「人」）は、同じ鍵の行があればそのまま写す（規則より先に）。
 * 2. 断っていない規則を、置いた順に 1 つずつ当て直す（規則の ID と根拠の文はそのまま）。人が受けていた規則は、同じ理由で受け直す。
 * 行の鍵は取り込みが中身から作るので、同じ資料と決定なら同じ鍵になる。行が無くなった分は数えて返す。
 */
export function carryOverCrosswalk(
  prev: Plan,
  prevProposals: readonly CrosswalkProposal[],
  next: Plan,
  itemCodes: ReadonlySet<string>,
  acceptedBasis: (basis: string, reason: string) => string,
): { plan: Plan; proposals: CrosswalkProposal[]; report: CarryOverReport } {
  let plan = next;
  let humanLost = 0;
  const nextNodes = new Set(next.assets.map((a) => a.nodeKey));
  const nextWorks = new Set(next.works.map((w) => w.workKey));
  const humanNodes = new Map(prev.assets.filter((a) => a.commonItemAuthor === "human" && a.commonItemAccepted).map((a) => [a.nodeKey, nodeMapping(a)]));
  const humanWorks = new Map(prev.works.filter((w) => w.attributeAuthor === "human" && w.attributeAccepted).map((w) => [w.workKey, workMapping(w)]));
  for (const k of humanNodes.keys()) if (!nextNodes.has(k)) humanLost++;
  for (const k of humanWorks.keys()) if (!nextWorks.has(k)) humanLost++;
  plan = {
    ...plan,
    assets: plan.assets.map((a) => {
      const m = humanNodes.get(a.nodeKey);
      return m && itemCodes.has(m.value ?? "") ? withNode(a, m) : a;
    }),
    works: plan.works.map((w) => {
      const m = humanWorks.get(w.workKey);
      return m ? withWork(w, m) : w;
    }),
  };
  const proposals: CrosswalkProposal[] = [];
  for (const p of prevProposals) {
    if (p.state === "rejected") continue;
    const r = proposeCrosswalk(plan, [p.rule], { itemCodes, basedOnVersion: p.basedOnVersion, nextRuleId: () => p.ruleId, basisOf: () => p.basis });
    if (!r.ok) continue;
    plan = r.plan;
    const fresh: CrosswalkProposal = { ...r.proposals[0]!, state: "proposed", humanReason: null };
    if (p.state === "accepted" && p.humanReason !== null) {
      const a = acceptProposal(plan, fresh, p.humanReason, acceptedBasis);
      if (a.ok) {
        plan = a.plan;
        proposals.push({ ...fresh, state: "accepted", humanReason: p.humanReason });
        continue;
      }
    }
    proposals.push(fresh);
  }
  return { plan, proposals, report: { rules: proposals.length, acceptedBefore: acceptedCount(prev), acceptedAfter: acceptedCount(plan), humanLost } };
}

/**
 * 人が画面で 1 つの行に直に当てる（作者「人」・人が受けた）。value が null なら当てはめを外す（値の無い行に戻す）。
 * 1 段目の項目はパックのコード、作業の属性は 4 つのどれかだけ。
 */
export function setMappingByHuman(
  plan: Plan,
  target: CrosswalkTarget,
  key: string,
  value: string | null,
  reason: string,
  itemCodes: ReadonlySet<string>,
  basisOf: (reason: string) => string,
): HumanOutcome {
  if (reason.trim() === "") return { ok: false, reason: "reasonEmpty" };
  const exists = target === "assetNode" ? plan.assets.some((a) => a.nodeKey === key) : plan.works.some((w) => w.workKey === key);
  if (!exists) return { ok: false, reason: "rowMissing" };
  if (value !== null && !(target === "assetNode" ? itemCodes.has(value) : (WORK_ATTRIBUTES as readonly string[]).includes(value))) return { ok: false, reason: "valueInvalid" };
  const ref = target === "assetNode" ? nodeRef(key) : workRef(key);
  const m: Mapping = value === null ? { value: null, author: null, basis: null, accepted: false } : { value, author: "human", basis: basisOf(reason.trim()), accepted: true };
  return { ok: true, plan: rewrite(plan, target, new Set([ref]), () => m), rows: 1 };
}
