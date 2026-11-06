// 星取の案（chart_propose の stars）：利用者がチャットで言った作業 × 年度の星取（計画 ○・実績 ●）を、足す案・消す案として置く。
// - 足す案は、作者が AI の作業明細 1 つ（明細の鍵 st-<案>-<p|a>-<作業>-<年度>）。周期の案と同じく、人が確定のシートで受けて署名するまで決まらない。
//   受けた案は版の計画にそのまま残り、受けた記録は今の acceptances（id「detail:<明細の鍵>」）で表す（版の記録の形は変えない）。
// - 消す案は、今ある星取（作業 × 年度 × 計画か実績）を指すだけ。計画は書き換えず、作業画面の状態に置く（state/stars.ts）。
//   人が受けると、その明細を作業中の計画から外す。版には「その明細が無い計画」として入る（差分レポートが消えた星取を出す）。
// - 作業は chart_rows の作業の行（id「w:<作業の鍵>」）で指す。年度は計画の範囲（明細のいちばん早い年度〜いちばん遅い年度）の中だけ。
// - 実績を足す案の根拠は、自施設の実績（bases.record：同じ機器の同じ年度に、ほかの作業の実績があること。その作業明細の数も根拠に書く）か、
//   利用者の言葉（author: ai_relayed_human）。パックの基準と計画ルールは実績の根拠にしない（基準は、した事を示さない）。
// - 実績を消す案は、利用者の言葉（author: ai_relayed_human）だけ。Claude の判断で施設の実績を消さない。
import type { Plan, SourceRef, WorkDetailT } from "../shared/plan";
import { CONVERSATION_SOURCE, PACK_SOURCE, RECORD_SOURCE, cycleIdOf, planRuleLine, planRuleSourceRef, recordIntervals, type VerifiedBases } from "./cycle";

/** 星取の案の ID の頭（周期の案の L・R・C と分ける） */
export const STAR_PREFIX = "S";
export const STAR_KEY = /^st-([A-Za-z0-9]+)-/;
/** 明細の鍵から、星取の足す案の ID（星取の案でなければ null） */
export const starIdOf = (detailKey: string): string | null => STAR_KEY.exec(detailKey)?.[1] ?? null;
/** 明細の鍵から、案の ID（周期の案か星取の足す案。どちらでもなければ null） */
export const proposalIdOf = (detailKey: string): string | null => cycleIdOf(detailKey) ?? starIdOf(detailKey);
export const isStarProposal = (id: string): boolean => id.startsWith(STAR_PREFIX);

/** chart_rows の作業の行の id */
export const workRowRef = (workKey: string): string => `w:${workKey}`;
export const workKeyOfRef = (rowRef: string): string | null => (rowRef.startsWith("w:") && rowRef.length > 2 ? rowRef.slice(2) : null);

export type StarValue = "plan" | "actual";
export interface StarIn {
  op: "add" | "remove";
  rowRef: string;
  value: StarValue;
  fiscalYear: number;
}

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

/** 消す案が指す明細：その作業 × 年度 × 計画か実績の明細のうち、案（周期の案・星取の足す案）でないもの */
export function removalTargets(plan: Plan, workKey: string, value: StarValue, fiscalYear: number): string[] {
  return plan.details.filter((d) => d.workKey === workKey && d.planOrActual === value && d.fiscalYear === fiscalYear && !isProposalDetail(d)).map((d) => d.detailKey);
}

/** 実績を足す案の、自施設の実績：同じ機器（作業の対象のどれか）の同じ年度の、ほかの作業の実績（作業の年度の値。案は数えない） */
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
}

/** 星取の案を確かめる（1 つでも合わなければ、どれも置かない）。合えば null、合わなければ誤りのコードと何番目か */
export function checkStars(plan: Plan, stars: readonly StarIn[], o: StarCheckOpts): { code: StarCode; index: number } | null {
  const years = planYears(plan);
  const works = new Set(plan.works.map((w) => w.workKey));
  for (const [i, s] of stars.entries()) {
    const wk = workKeyOfRef(s.rowRef);
    if (wk === null || !works.has(wk)) return { code: "star_work_unknown", index: i };
    if (!years || s.fiscalYear < years.lo || s.fiscalYear > years.hi) return { code: "star_out_of_range", index: i };
    if (o.fromLedger) return { code: "star_basis_invalid", index: i };
    if (s.op === "add" && s.value === "actual") {
      if (o.actualUpTo !== null && s.fiscalYear > o.actualUpTo) return { code: "star_out_of_range", index: i };
      // 実績の根拠：パックの基準・計画ルールは使えない。自施設の実績の作業明細か、利用者の言葉が要る
      if (o.verified.pack || o.verified.rule) return { code: "star_basis_invalid", index: i };
      if (o.verified.record ? actualEvidence(plan, wk, s.fiscalYear).length === 0 : o.author !== "ai_relayed_human") return { code: "star_basis_invalid", index: i };
    }
    if (s.op === "remove") {
      if (s.value === "actual" && o.author !== "ai_relayed_human") return { code: "star_basis_invalid", index: i };
      if (removalTargets(plan, wk, s.value, s.fiscalYear).length === 0) return { code: "star_unknown", index: i };
    }
  }
  return null;
}

const sourceRef = (file: string, sheet: string | null = null): SourceRef => ({ file, sheet, page: null, cell: null, box: null });
const VALUE_TEXT: Record<StarValue, string> = { plan: "計画", actual: "実績" };
/** 実績の根拠に写す元のセルの数の上限 */
const EVIDENCE_SOURCES_MAX = 5;

export interface PlacedStar {
  id: string;
  workKey: string;
  value: StarValue;
  fiscalYear: number;
  /** 足した明細の鍵。同じ星取がもうあれば null（足さない） */
  detailKey: string | null;
}

/**
 * 足す案を置く（確かめは checkStars で済ませてあること）。同じ作業 × 年度 × 計画か実績の明細がもうあれば足さない。
 * 根拠の文：利用者か Claude の 1 文に、案の ID と中身、MOYAI が照らした根拠（実績の明細の数・実績の間隔・パックの基準・計画ルール）を足す
 */
export function proposeStars(
  plan: Plan,
  adds: readonly StarIn[],
  o: { nextId: () => string; basis: string; author: "ai" | "ai_relayed_human"; verified: VerifiedBases },
): { plan: Plan; placed: PlacedStar[] } {
  const details = [...plan.details];
  const placed: PlacedStar[] = [];
  const has = (wk: string, v: StarValue, fy: number) => details.some((d) => d.workKey === wk && d.planOrActual === v && d.fiscalYear === fy);
  for (const s of adds) {
    const wk = workKeyOfRef(s.rowRef)!;
    const id = o.nextId();
    if (has(wk, s.value, s.fiscalYear)) {
      placed.push({ id, workKey: wk, value: s.value, fiscalYear: s.fiscalYear, detailKey: null });
      continue;
    }
    const v = o.verified;
    const sources: SourceRef[] = [];
    const lines: string[] = [];
    if (s.value === "actual") {
      const ev = v.record ? actualEvidence({ ...plan, details }, wk, s.fiscalYear) : [];
      if (ev.length > 0) {
        sources.push(sourceRef(RECORD_SOURCE));
        const seen = new Set<string>();
        for (const x of ev.flatMap((d) => d.sources)) {
          const k = JSON.stringify(x);
          if (seen.has(k) || seen.size >= EVIDENCE_SOURCES_MAX) continue;
          seen.add(k);
          sources.push({ ...x });
        }
        const n = ev.reduce((m, d) => m + (d.lines?.length ?? 0), 0);
        lines.push(`自施設の実績：同じ機器の ${s.fiscalYear} 年度の実績 ${ev.length}（作業明細 ${n}）`);
      }
    } else {
      const w = plan.works.find((x) => x.workKey === wk);
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
    if (o.author === "ai_relayed_human" || sources.length === 0) sources.unshift(sourceRef(CONVERSATION_SOURCE));
    const detailKey = `st-${id}-${s.value === "plan" ? "p" : "a"}-${wk}-${s.fiscalYear}`;
    details.push({
      detailKey,
      workKey: wk,
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
      basis: `${o.basis}（案 ${id}：追加 ${VALUE_TEXT[s.value]} ${s.fiscalYear} 年度）${lines.map((x) => `。${x}`).join("")}`,
      author: o.author,
      needsReview: false,
    });
    placed.push({ id, workKey: wk, value: s.value, fiscalYear: s.fiscalYear, detailKey });
  }
  return { plan: { ...plan, details }, placed };
}

/** 消す案の根拠の文（作業画面の状態に置き、確定のシートに出す） */
export const removalBasis = (basis: string, id: string, value: StarValue, fiscalYear: number): string => `${basis}（案 ${id}：削除 ${VALUE_TEXT[value]} ${fiscalYear} 年度）`;
