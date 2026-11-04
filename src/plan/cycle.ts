// 周期の案（docs/plan.md §2.18.4）：chart_propose の規則で、作業のきっかけの暦の枝（n 年ごと）を案として置き、計画の印（○）を引く。
// - 会期中は足すだけ（今ある印を消さない）。計画の印がもうある年度には足さない（起点は最後の実施なので、実施のある年度に重なることはない）。
// - 起点は、その作業の最後の実施の年度。実施が無い作業、計画の終わりの年度（計画のいちばん遅い年度）が起点より前の作業には置かず、数えて返す（推測で埋めない）。
// - 引いた印は作者が AI の明細で、根拠に台帳の版と集計を書く。人が決定のシートで受けて署名するまで決まらない。
// - 1 つの案（規則）で引いた印は、明細の鍵の頭（cy-<案>-）でまとめ、決定のシートでは 1 行にする。
import type { Plan, WorkDetailT } from "../shared/plan";
import type { Rule } from "../shared/tools";
import { worksHitBy } from "./crosswalk";

export const CYCLE_FIELD = "work.trigger";
export const CYCLE_YEARS = { min: 1, max: 30 } as const;
/** 台帳から来た印の出どころ（資料ではないので、資料の名前の代わりにこの印を置く） */
export const LEDGER_SOURCE = "ledger:公開の台帳";
export const CYCLE_KEY = /^cy-([A-Za-z0-9]+)-/;

export interface CycleProposal {
  id: string;
  years: number;
  basis: string;
  /** この案で引いた明細の鍵 */
  detailKeys: string[];
  /** 当たった作業の数 */
  works: number;
  /** 置かなかった作業：実施が無い・計画の終わりの年度が起点より前 */
  skipped: { noActual: number; noHorizon: number };
}

export type CycleOutcome =
  | { ok: true; plan: Plan; proposals: CycleProposal[] }
  | { ok: false; code: "rule_invalid"; ruleIndex: number };

/** 規則が周期の案として正しいか：置く欄は作業のきっかけ、値は 1〜30 の整数の年数 */
export function cycleYearsOf(rule: Rule): number | null {
  if (rule.set.field !== CYCLE_FIELD) return null;
  const v = rule.set.value;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= CYCLE_YEARS.min && n <= CYCLE_YEARS.max ? n : null;
}

export function proposeCycles(plan: Plan, rules: Rule[], opts: { nextId: () => string; basis: string }): CycleOutcome {
  for (const [i, r] of rules.entries()) if (cycleYearsOf(r) === null) return { ok: false, code: "rule_invalid", ruleIndex: i };
  const horizon = plan.details.reduce((m, d) => Math.max(m, d.fiscalYear), -Infinity);
  const details: WorkDetailT[] = [...plan.details];
  const proposals: CycleProposal[] = [];
  for (const rule of rules) {
    const years = cycleYearsOf(rule)!;
    const id = opts.nextId();
    const basis = `${opts.basis}（案 ${id}：${years} 年ごと。${rule.reason}）`;
    const p: CycleProposal = { id, years, basis, detailKeys: [], works: 0, skipped: { noActual: 0, noHorizon: 0 } };
    for (const w of worksHitBy(plan, rule)) {
      p.works++;
      const mine = details.filter((d) => d.workKey === w.workKey);
      const last = mine.filter((d) => d.planOrActual === "actual").reduce((m, d) => Math.max(m, d.fiscalYear), -Infinity);
      if (!Number.isFinite(last)) {
        p.skipped.noActual++;
        continue;
      }
      if (!(horizon >= last + years)) {
        p.skipped.noHorizon++;
        continue;
      }
      const planned = new Set(mine.filter((d) => d.planOrActual === "plan").map((d) => d.fiscalYear));
      for (let y = last + years; y <= horizon; y += years) {
        if (planned.has(y)) continue;
        const detailKey = `cy-${id}-${w.workKey}-${y}`;
        details.push({
          detailKey,
          workKey: w.workKey,
          planOrActual: "plan",
          step: null,
          startDate: null,
          endDate: null,
          fiscalYear: y,
          cost: null,
          manDays: null,
          days: null,
          resultScale: null,
          resultValue: null,
          measuredValue: null,
          previousValue: null,
          performer: null,
          sources: [{ file: LEDGER_SOURCE, sheet: null, page: null, cell: null, box: null }],
          basis,
          author: "ai",
          needsReview: false,
        });
        p.detailKeys.push(detailKey);
        planned.add(y);
      }
    }
    proposals.push(p);
  }
  return { ok: true, plan: { ...plan, details }, proposals };
}

/** 明細の鍵から、周期の案の ID（周期の案でなければ null） */
export const cycleIdOf = (detailKey: string): string | null => CYCLE_KEY.exec(detailKey)?.[1] ?? null;
