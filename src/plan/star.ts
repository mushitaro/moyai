// 星取の案（chart_propose の stars。docs/screens.md 3.2「会話からの星取の案」、Wire、11-06 夜）：利用者がチャットで言った作業 × 年度の星取（計画 ○・実績 ●）を、
// 追加・削除・移動の案として置く。人が確定のシートで確定するまで決まらない。
// - 1 つの頼み（1 回の chart_propose）で、同じ作業の同じ種類（計画の追加・計画の削除・計画の移動・実績の追加・実績の削除）は 1 つの案（ID の頭 S）にまとめる。
//   確定のシートでは 1 案 1 行で、詳しくに星取を 1 つずつ並べる。
// - 追加は、作者が AI の作業の年度の値（明細の鍵 st-<案>-<p|a>-<作業>-<年度>）。受けた記録は今の acceptances（id「detail:<明細の鍵>」）で表す（版の記録の形は変えない）。
// - 削除は、今ある星取（作業 × 年度 × 計画か実績）を指すだけ。計画は書き換えず、作業画面の状態に置く（state/stars.ts）。
//   人が確定すると、その明細を作業中の計画から外す。版には「その星取が無い計画」として入る（差分レポートが削除を出す）。
// - 移動（延期・前倒し）は、同じ作業の計画の削除と追加の対で、1 つの案にする。
// - 作業は chart_rows の作業の行（id「w:<作業の鍵>」）で指す。年度は計画の範囲（明細のいちばん早い年度〜いちばん遅い年度）の中だけ。
// - 実績の追加は、利用者の言葉（author: ai_relayed_human）のときだけ置く（Architect の 71。決まり 4：推測で埋めない）。
//   同じ機器の同じ年度に、ほかの作業の実績があれば、根拠ではなく参考の行として根拠の文に添える（出どころには足さない）。
//   bases（record・pack・rule）は実績の根拠にしない（基準は、した事を示さない。ほかの作業の実績は、その作業をした事を示さない）。
// - 実績の削除は、利用者の言葉（author: ai_relayed_human）だけ。Claude の判断で施設の実績を消さない。
import type { Plan, SourceRef, WorkDetailT } from "../shared/plan";
import { CONVERSATION_SOURCE, PACK_SOURCE, RECORD_SOURCE, cycleIdOf, planRuleLine, planRuleSourceRef, recordIntervals, type VerifiedBases } from "./cycle";

/** 星取の案の ID の頭（周期の案の L・R・C と分ける） */
export const STAR_PREFIX = "S";
/** 人の試し（星取表で人が未来の ○ を動かした。時間の地図 2、mushitaro/moyai#32）の出どころ */
export const TRIAL_SOURCE = "trial:人の試し";
export const STAR_KEY = /^st-([A-Za-z0-9]+)-/;
/** 明細の鍵から、星取の案の ID（星取の追加の案でなければ null） */
export const starIdOf = (detailKey: string): string | null => STAR_KEY.exec(detailKey)?.[1] ?? null;
/** 明細の鍵から、案の ID（周期の案か星取の追加の案。どちらでもなければ null） */
export const proposalIdOf = (detailKey: string): string | null => cycleIdOf(detailKey) ?? starIdOf(detailKey);
export const isStarProposal = (id: string): boolean => id.startsWith(STAR_PREFIX);

/** chart_rows の作業の行の id */
export const workRowRef = (workKey: string): string => `w:${workKey}`;
export const workKeyOfRef = (rowRef: string): string | null => (rowRef.startsWith("w:") && rowRef.length > 2 ? rowRef.slice(2) : null);

export type StarValue = "plan" | "actual";
/** chart_propose の stars の 1 つ（移動は計画だけ） */
export type StarIn =
  | { op: "add" | "remove"; rowRef: string; value: StarValue; fiscalYear: number }
  | { op: "move"; rowRef: string; fromFiscalYear: number; fiscalYear: number };

/** 案の種類（確定のシートの行の題） */
export type StarKind = "planAdd" | "planRemove" | "planMove" | "actualAdd" | "actualRemove";
export const starKindOf = (s: StarIn): StarKind => (s.op === "move" ? "planMove" : (`${s.value}${s.op === "add" ? "Add" : "Remove"}` as StarKind));
/** 追加の明細の鍵から、計画か実績か */
export const starValueOfKey = (detailKey: string): StarValue | null => {
  const m = /^st-[A-Za-z0-9]+-([pa])-/.exec(detailKey);
  return m ? (m[1] === "p" ? "plan" : "actual") : null;
};

/** 計画の範囲：明細のいちばん早い年度〜いちばん遅い年度（星取表の列と同じ）。明細が無ければ null */
export function planYears(plan: Plan): { lo: number; hi: number } | null {
  if (plan.details.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of plan.details) {
    lo = Math.min(lo, d.fiscalYear);
    hi = Math.max(hi, d.fiscalYear);
  }
  return { lo, hi };
}

const isProposalDetail = (d: WorkDetailT) => proposalIdOf(d.detailKey) !== null;

/** 削除の案が指す明細：その作業 × 年度 × 計画か実績の明細のうち、案（周期の案・星取の追加の案）でないもの */
export function removalTargets(plan: Plan, workKey: string, value: StarValue, fiscalYear: number): string[] {
  return plan.details.filter((d) => d.workKey === workKey && d.planOrActual === value && d.fiscalYear === fiscalYear && !isProposalDetail(d)).map((d) => d.detailKey);
}

/** 実績の追加の、自施設の実績：同じ機器（作業の対象のどれか）の同じ年度の、ほかの作業の実績（作業の年度の値。案は数えない） */
export function actualEvidence(plan: Plan, workKey: string, fiscalYear: number): WorkDetailT[] {
  const w = plan.works.find((x) => x.workKey === workKey);
  if (!w) return [];
  const nodes = new Set(w.targets);
  const works = new Map(plan.works.map((x) => [x.workKey, x]));
  return plan.details.filter(
    (d) => d.planOrActual === "actual" && d.fiscalYear === fiscalYear && d.workKey !== workKey && !isProposalDetail(d) && (works.get(d.workKey)?.targets ?? []).some((t) => nodes.has(t)),
  );
}

export type StarCode = "star_work_unknown" | "star_out_of_range" | "star_unknown" | "star_basis_invalid";

export interface StarCheckOpts {
  author: "ai" | "ai_relayed_human";
  verified: VerifiedBases;
  /** 台帳を根拠にした（星取には使えない） */
  fromLedger: boolean;
  /** 実績を置ける最後の年度（基準日の年度）。無ければ縛らない */
  actualUpTo: number | null;
  /** 計画の最大年度（施設の見せ方。星取表の列の最後の年度）。計画の最後の年度より後なら、範囲をこの年度まで広げる */
  lastFiscalYear?: number | null;
}

/** 星取の案を確かめる（1 つでも合わなければ、どれも置かない）。合えば null、合わなければ誤りのコードと何番目か */
export function checkStars(plan: Plan, stars: readonly StarIn[], o: StarCheckOpts): { code: StarCode; index: number } | null {
  const years = planYears(plan);
  const works = new Set(plan.works.map((w) => w.workKey));
  const hi = years ? Math.max(years.hi, o.lastFiscalYear ?? -Infinity) : -Infinity;
  const inRange = (fy: number) => !!years && fy >= years.lo && fy <= hi;
  for (const [i, s] of stars.entries()) {
    const wk = workKeyOfRef(s.rowRef);
    if (wk === null || !works.has(wk)) return { code: "star_work_unknown", index: i };
    if (!inRange(s.fiscalYear) || (s.op === "move" && (!inRange(s.fromFiscalYear) || s.fromFiscalYear === s.fiscalYear))) return { code: "star_out_of_range", index: i };
    if (o.fromLedger) return { code: "star_basis_invalid", index: i };
    if (s.op === "add" && s.value === "actual") {
      if (o.actualUpTo !== null && s.fiscalYear > o.actualUpTo) return { code: "star_out_of_range", index: i };
      // 実績の追加は利用者の言葉だけ（Architect の 71）。パックの基準・計画ルールは実績の根拠にしない
      if (o.author !== "ai_relayed_human" || o.verified.pack || o.verified.rule) return { code: "star_basis_invalid", index: i };
    }
    if (s.op === "remove") {
      if (s.value === "actual" && o.author !== "ai_relayed_human") return { code: "star_basis_invalid", index: i };
      if (removalTargets(plan, wk, s.value, s.fiscalYear).length === 0) return { code: "star_unknown", index: i };
    }
    if (s.op === "move" && removalTargets(plan, wk, "plan", s.fromFiscalYear).length === 0) return { code: "star_unknown", index: i };
  }
  return null;
}

const sourceRef = (file: string, sheet: string | null = null): SourceRef => ({ file, sheet, page: null, cell: null, box: null });
/** 根拠の文に書く種類の字（docs/screens.md 3.2 の行の題と同じ） */
export const STAR_KIND_TEXT: Record<StarKind, string> = { planAdd: "計画の追加", planRemove: "計画の削除", planMove: "計画の移動", actualAdd: "実績の追加", actualRemove: "実績の削除" };
/**
 * 実績の追加の詳しくの参考（Wire、11-06 夜）：1 行目は根拠の文と同じ「参考　同じ機器の…」、その下に作業ごとの「火格子交換　作業明細 3」を 3 つまで、残りは数。
 * 参考が無ければ null
 */
export function actualReferenceView(plan: Plan, workKey: string, fy: number): { head: string; items: { name: string; lines: number }[]; more: number } | null {
  const ev = actualEvidence(plan, workKey, fy);
  if (ev.length === 0) return null;
  const by = new Map<string, number>();
  for (const d of ev) by.set(d.workKey, (by.get(d.workKey) ?? 0) + (d.lines?.length ?? 0));
  const names = new Map(plan.works.map((w) => [w.workKey, w.kind || w.workKey]));
  const all = [...by].map(([k, lines]) => ({ name: names.get(k) ?? k, lines }));
  return { head: actualReference(fy, ev), items: all.slice(0, 3), more: Math.max(0, all.length - 3) };
}

/** 詳しくに出す理由：根拠の文から参考の行を外したもの（参考は理由の下に別の行で出すので、二重に出さない） */
export const basisWithoutReference = (basis: string): string => basis.split("。参考　同じ機器の")[0]!;

/** 実績の追加の参考の行：「参考　同じ機器の 2024 年度の実績 1（作業明細 3）」 */
export const actualReference = (fy: number, ev: readonly WorkDetailT[]): string =>
  `参考　同じ機器の ${fy} 年度の実績 ${ev.length}（作業明細 ${ev.reduce((m, d) => m + (d.lines?.length ?? 0), 0)}）`;

export interface StarAdd {
  /** 案の ID（同じ頼みの同じ作業・同じ種類で 1 つ） */
  id: string;
  kind: StarKind;
  workKey: string;
  value: StarValue;
  fiscalYear: number;
}

/**
 * 追加を置く（確かめは checkStars で済ませてあること）。同じ作業 × 年度 × 計画か実績の明細がもうあれば足さない（detailKey は null）。
 * 根拠の文：利用者か Claude の 1 文に、案の ID と中身、MOYAI が照らした根拠（実績の数・実績の間隔・パックの基準・計画ルール）を足す
 */
export function proposeStars(
  plan: Plan,
  adds: readonly StarAdd[],
  o: { basis: string; author: "ai" | "ai_relayed_human" | "human"; verified: VerifiedBases },
): { plan: Plan; placed: (StarAdd & { detailKey: string | null })[] } {
  const details = [...plan.details];
  const placed: (StarAdd & { detailKey: string | null })[] = [];
  const has = (wk: string, v: StarValue, fy: number) => details.some((d) => d.workKey === wk && d.planOrActual === v && d.fiscalYear === fy);
  for (const s of adds) {
    if (has(s.workKey, s.value, s.fiscalYear)) {
      placed.push({ ...s, detailKey: null });
      continue;
    }
    const v = o.verified;
    const sources: SourceRef[] = [];
    const lines: string[] = [];
    if (s.value === "actual") {
      // 参考の行（根拠ではない。出どころに足さない。言葉は Wire に確かめる）
      const ev = actualEvidence({ ...plan, details }, s.workKey, s.fiscalYear);
      if (ev.length > 0) lines.push(actualReference(s.fiscalYear, ev));
    } else {
      const w = plan.works.find((x) => x.workKey === s.workKey);
      const rec = v.record && w ? recordIntervals(details, [w]) : null;
      if (rec) {
        sources.push(sourceRef(RECORD_SOURCE));
        lines.push(`自施設の実績：実績の間隔 ${rec.min === rec.max ? `${rec.min} 年` : `${rec.min}〜${rec.max} 年`}`);
      }
      if (v.pack) {
        sources.push(sourceRef(PACK_SOURCE, v.pack.checkId));
        lines.push(`パックの基準「${v.pack.name}」（${v.pack.checkId}。出典 ${v.pack.source}）`);
      }
      if (v.rule) {
        sources.push(planRuleSourceRef(v.rule.name, v.rule.ruleId));
        lines.push(planRuleLine(v.rule.name, v.rule.version, v.rule.status, v.rule.text));
      }
    }
    // 人の試し（星取表で人が動かした ○）は、会話ではなく人の操作が出どころ
    if (o.author === "human") sources.unshift(sourceRef(TRIAL_SOURCE));
    else if (o.author === "ai_relayed_human" || sources.length === 0) sources.unshift(sourceRef(CONVERSATION_SOURCE));
    const detailKey = `st-${s.id}-${s.value === "plan" ? "p" : "a"}-${s.workKey}-${s.fiscalYear}`;
    details.push({
      detailKey,
      workKey: s.workKey,
      planOrActual: s.value,
      step: null,
      startDate: null,
      endDate: null,
      fiscalYear: s.fiscalYear,
      cost: null,
      manDays: null,
      days: null,
      resultScale: null,
      resultValue: null,
      measuredValue: null,
      previousValue: null,
      performer: null,
      sources,
      basis: `${o.basis}（案 ${s.id}：${STAR_KIND_TEXT[s.kind]} ${s.fiscalYear} 年度）${lines.map((x) => `。${x}`).join("")}`,
      author: o.author,
      needsReview: false,
    });
    placed.push({ ...s, detailKey });
  }
  return { plan: { ...plan, details }, placed };
}

/** 削除の案の根拠の文（作業画面の状態に置き、確定のシートに出す） */
export const removalBasis = (basis: string, id: string, kind: StarKind, years: readonly number[]): string =>
  `${basis}（案 ${id}：${STAR_KIND_TEXT[kind]} ${years.map((y) => `${y} 年度`).join("・")}）`;
