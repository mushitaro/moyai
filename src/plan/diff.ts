// 版どうしの差（印の前後）と、人が受けていない決定（docs/plan.md §2.9）。
// 画面（確定のダイアログ）と橋渡し（版のファイルと差分レポート）が同じこの関数を使う。純粋な TS（UI もネットも持たない）。
import type { AuthorKind } from "../shared/fields";
import type { Plan } from "../shared/plan";
import { cycleIdOf } from "./cycle";
import { assetLabels } from "./asset-names";

export type DiffMark = "plan" | "actual" | "both";

/** 差の 1 行：機器 × 作業 × 年度の印の前後 */
export interface DiffRow {
  nodeKey: string;
  workKey: string;
  fiscalYear: number;
  /** 機器の名前（星取表と同じ見せる名前：号機で分かれる同じ名前の機器は「名前 号機」）・作業の名前（資料に書いてあったもの） */
  equipment: string;
  work: string;
  before: DiffMark | null;
  after: DiffMark | null;
  /** 後（消えたものは前）の印のもとの記録の作者と根拠（重ねない、出てきた順） */
  authors: AuthorKind[];
  basis: string[];
}

export interface PlanDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
  /** 前と同じ印の数 */
  same: number;
}

interface Cell {
  equipment: string;
  work: string;
  plan: boolean;
  actual: boolean;
  authors: AuthorKind[];
  basis: string[];
}

function cells(plan: Plan | null): Map<string, Cell & { nodeKey: string; workKey: string; fiscalYear: number }> {
  const out = new Map<string, Cell & { nodeKey: string; workKey: string; fiscalYear: number }>();
  if (!plan) return out;
  // 機器の名前は星取表と同じ見せる名前（号機で分かれる同じ名前の機器は「名前 号機」。asset-names.ts）。差の鍵と版の記録は変えない
  const names = assetLabels(plan.assets);
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  for (const d of plan.details) {
    const w = works.get(d.workKey);
    if (!w) continue;
    for (const nodeKey of w.targets) {
      const key = `${nodeKey}\u0000${w.workKey}\u0000${d.fiscalYear}`;
      let c = out.get(key);
      if (!c) {
        c = { nodeKey, workKey: w.workKey, fiscalYear: d.fiscalYear, equipment: names.get(nodeKey) ?? nodeKey, work: w.kind, plan: false, actual: false, authors: [], basis: [] };
        out.set(key, c);
      }
      if (d.planOrActual === "plan") c.plan = true;
      else c.actual = true;
      if (!c.authors.includes(d.author)) c.authors.push(d.author);
      if (!c.basis.includes(d.basis)) c.basis.push(d.basis);
    }
  }
  return out;
}

const markOf = (c: Cell | undefined): DiffMark | null => (!c ? null : c.plan && c.actual ? "both" : c.actual ? "actual" : c.plan ? "plan" : null);

/** 前の版（無ければ null）から後の版への、印の差。並びは機器・作業・年度の順。 */
export function diffPlans(before: Plan | null, after: Plan): PlanDiff {
  const a = cells(before);
  const b = cells(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let same = 0;
  for (const k of keys) {
    const x = a.get(k);
    const y = b.get(k);
    const mx = markOf(x);
    const my = markOf(y);
    if (mx === my) {
      same++;
      continue;
    }
    if (mx === null) added++;
    else if (my === null) removed++;
    else changed++;
    const src = (y ?? x)!;
    rows.push({
      nodeKey: src.nodeKey,
      workKey: src.workKey,
      fiscalYear: src.fiscalYear,
      equipment: src.equipment,
      work: src.work,
      before: mx,
      after: my,
      authors: [...src.authors],
      basis: [...src.basis],
    });
  }
  rows.sort((p, q) => (p.equipment !== q.equipment ? (p.equipment < q.equipment ? -1 : 1) : p.work !== q.work ? (p.work < q.work ? -1 : 1) : p.fiscalYear - q.fiscalYear));
  return { rows, added, removed, changed, same };
}

// ─── 人が受けていない決定 ─────────────────────────────────

/** 人が画面で受けるまで確定できない作者（AI と、AI が会話から写した人の答え） */
export const NEEDS_HUMAN_AUTHORS: readonly AuthorKind[] = ["ai", "ai_relayed_human"];

export interface Decision {
  /** 決定の ID（何の決定か）："item:<資産の鍵>"・"attr:<作業の鍵>"・"detail:<明細の鍵>"・"reading:<質問の番号>" */
  id: string;
  kind: "commonItem" | "attribute" | "detail" | "reading";
  author: AuthorKind;
  /** 画面に出す対象（機器の名前・作業の名前） */
  target: string;
  /** 決めた値（共通の設備項目のコード、作業の属性のコード、または「計画／実施 · 年度」） */
  value: string;
  basis: string;
  /** 中身の指紋。受けたあとに中身が変われば、また受けていない決定になる */
  hash: string;
  /** 読み方の決定：効く明細の数（明細の数で言えない決定は null）と、効く所（Wire） */
  count?: number | null;
  where?: string;
}

export interface Acceptance {
  id: string;
  hash: string;
  reason: string;
  /** 受けた版（版の履歴から読んだときだけ。署名される字ではない） */
  version?: number;
}

// ─── 人が確定した星取の削除（Architect の 70） ─────────────────────────────
// 削除は計画に案として置けない（消したものは計画に無い）ので、確定した削除は acceptances と同じ形で版の記録に入れる：
// id「remove:<明細の鍵>」・消した明細の中身の指紋・人の理由・作者（human）。署名の内側に入り、次の版でも資料から読み直した星取を外したままにする。
export const REMOVAL_PREFIX = "remove:";
export const removalId = (detailKey: string): string => `${REMOVAL_PREFIX}${detailKey}`;
export const isRemovalId = (id: string): boolean => id.startsWith(REMOVAL_PREFIX);
/** 消した明細の中身の指紋（決定の明細と同じ欄から） */
export const removalHash = (d: Pick<Plan["details"][number], "detailKey" | "workKey" | "planOrActual" | "fiscalYear" | "startDate" | "endDate" | "author" | "basis">): string =>
  fnv64(JSON.stringify([d.detailKey, d.workKey, d.planOrActual, d.fiscalYear, d.startDate, d.endDate, d.author, d.basis]));

/** 64 ビットの FNV-1a（16 進 16 文字）。暗号ではなく、受けた中身と今の中身を照らすだけ。 */
export function fnv64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n;
  for (const b of new TextEncoder().encode(text)) {
    h ^= BigInt(b);
    h = (h * p) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** 計画の中の、AI が決めたもの（作者が AI か AI（チャットでの人の答え））の一覧。 */
export function aiDecisions(plan: Plan): Decision[] {
  const out: Decision[] = [];
  // 読み方の決定は、明細の作者に写らなくても（年度の読み方・列の役目など）ここで受けてもらう。1 つの決定は 1 行で、
  // それで作者が決まった明細は行に出さず、決定に付いて動く（効く明細が変われば、また受けていない決定になる。Wire）
  const covered = new Set<string>();
  for (const r of plan.readingDecisions ?? []) {
    if (!NEEDS_HUMAN_AUTHORS.includes(r.author)) continue;
    const ds = [...(r.details ?? [])].sort();
    for (const k of ds) covered.add(k);
    out.push({
      id: `reading:${r.questionId}`,
      kind: "reading",
      author: r.author,
      target: r.question,
      value: r.answer,
      basis: r.reason,
      hash: fnv64(JSON.stringify([r.questionId, r.answer, r.author, r.reason, ds])),
      count: ds.length > 0 ? ds.length : null,
      ...(r.where ? { where: r.where } : {}),
    });
  }
  for (const a of plan.assets) {
    if (a.commonItem === null || a.commonItemAuthor === null || !NEEDS_HUMAN_AUTHORS.includes(a.commonItemAuthor)) continue;
    if (a.commonItemAccepted) continue;
    out.push({
      id: `item:${a.nodeKey}`,
      kind: "commonItem",
      author: a.commonItemAuthor,
      target: a.name,
      value: a.commonItem,
      basis: a.commonItemBasis ?? "",
      hash: fnv64(JSON.stringify([a.nodeKey, a.commonItem, a.commonItemAuthor, a.commonItemBasis])),
    });
  }
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  const names = new Map(plan.assets.map((a) => [a.nodeKey, a.name]));
  for (const w of plan.works) {
    if (w.attribute === null || w.attributeAuthor === null || !NEEDS_HUMAN_AUTHORS.includes(w.attributeAuthor)) continue;
    if (w.attributeAccepted) continue;
    out.push({
      id: `attr:${w.workKey}`,
      kind: "attribute",
      author: w.attributeAuthor,
      target: `${w.targets.map((k) => names.get(k) ?? k).join("、")} · ${w.kind}`,
      value: w.attribute,
      basis: w.attributeBasis ?? "",
      hash: fnv64(JSON.stringify([w.workKey, w.attribute, w.attributeAuthor, w.attributeBasis])),
    });
  }
  for (const d of plan.details) {
    if (!NEEDS_HUMAN_AUTHORS.includes(d.author) || covered.has(d.detailKey)) continue;
    const w = works.get(d.workKey);
    out.push({
      id: `detail:${d.detailKey}`,
      kind: "detail",
      author: d.author,
      target: `${(w?.targets ?? []).map((k) => names.get(k) ?? k).join("、")} · ${w?.kind ?? d.workKey}`,
      value: `${d.planOrActual}:${d.fiscalYear}`,
      basis: d.basis,
      // 指紋は中身（何の・いつの・誰の・どこから）。資料から読んだ明細は、根拠の文の言い方（basis）を入れず、出どころのセル（資料・シート・セル。決まった順）を入れる
      // （言い方だけが変わった版で、受けた明細を受け直しにしない。Architect の 69）。
      // 周期の案（cy-）は、根拠の文が照らした中身そのもの（台帳の版・類似施設の数・「第 n 版で受けた当てはめと同じ」）なので、これまでどおり basis も入れる（新-10）
      hash: fnv64(JSON.stringify([d.detailKey, d.workKey, d.planOrActual, d.fiscalYear, d.startDate, d.endDate, d.author, sourceKeys(d.sources), ...(cycleIdOf(d.detailKey) !== null ? [d.basis] : [])])),
    });
  }
  return out;
}

/** 明細の出どころの並び（資料・シート・セル）。並べ方で指紋が変わらないよう、決まった順にそろえる */
function sourceKeys(sources: readonly { file: string; sheet: string | null; cell: string | null }[]): string[] {
  return [...new Set(sources.map((x) => JSON.stringify([x.file, x.sheet ?? "", x.cell ?? ""])))].sort();
}

/** 人が受けていない決定：AI の決定のうち、前の版までに同じ中身で受けていないもの。 */
export function pendingDecisions(plan: Plan, accepted: readonly { id: string; hash: string }[]): Decision[] {
  const ok = new Set(accepted.map((a) => `${a.id}\u0000${a.hash}`));
  return aiDecisions(plan).filter((d) => !ok.has(`${d.id}\u0000${d.hash}`));
}

/** 受けた決定を計画に効かせる：共通の設備項目と作業の属性の当てはめは「人が受けた」にする（作者は AI のまま残す）。 */
export function applyAcceptances(plan: Plan, acceptances: readonly Acceptance[]): Plan {
  const items = new Set(acceptances.filter((a) => a.id.startsWith("item:")).map((a) => a.id.slice("item:".length)));
  const attrs = new Set(acceptances.filter((a) => a.id.startsWith("attr:")).map((a) => a.id.slice("attr:".length)));
  if (items.size === 0 && attrs.size === 0) return plan;
  return {
    ...plan,
    assets: plan.assets.map((a) => (items.has(a.nodeKey) ? { ...a, commonItemAccepted: true } : a)),
    works: plan.works.map((w) => (attrs.has(w.workKey) ? { ...w, attributeAccepted: true } : w)),
  };
}
