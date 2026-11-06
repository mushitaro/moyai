// 周期の案（docs/plan.md §2.18.4）：chart_propose の規則で、作業のきっかけの暦の枝（n 年ごと）を案として置き、計画の印（○）を引く。
// - 会期中は足すだけ（今ある印を消さない）。計画の印がもうある年度には足さない（起点は最後の実施なので、実施のある年度に重なることはない）。
// - 起点は、その作業の最後の実施の年度。実施が無い作業、計画の終わりの年度（計画のいちばん遅い年度）が起点より前の作業には置かず、数えて返す（推測で埋めない）。
// - 引いた印は作者が AI の明細で、根拠に台帳の版と集計を書く。人が決定のシートで受けて署名するまで決まらない。
// - 1 つの案（規則）で引いた印は、明細の鍵の頭（cy-<案>-）でまとめ、決定のシートでは 1 行にする。
import type { Plan, SourceRef, WorkDetailT, WorkT } from "../shared/plan";
import type { Rule } from "../shared/tools";
import { shortVersion } from "../import/reading";
import { worksHitBy } from "./crosswalk";

export const CYCLE_FIELD = "work.trigger";
export const CYCLE_YEARS = { min: 1, max: 30 } as const;
/** 台帳から来た印の出どころ（資料ではないので、資料の名前の代わりにこの印を置く） */
export const LEDGER_SOURCE = "ledger:公開の台帳";
/** 台帳を照らしていない案（利用者の言葉や Claude の判断から置いた案）の出どころ（台帳の中-5 の残り） */
export const CONVERSATION_SOURCE = "conversation:Claude との会話";
/** 台帳を照らした案の ID の頭（ほかは C。決定のシートの種類を分ける） */
export const LEDGER_CYCLE_PREFIX = "L";
export const isLedgerCycle = (id: string): boolean => id.startsWith(LEDGER_CYCLE_PREFIX);
/** 計画ルール（3 段目の Skill の planCycle）から出した案の ID の頭（L・C と分ける。決定のシートの種類「ルール案」） */
export const PLAN_RULE_CYCLE_PREFIX = "R";
export const isPlanRuleCycle = (id: string): boolean => id.startsWith(PLAN_RULE_CYCLE_PREFIX);
/** 計画ルールの出どころ。sheet にルールの名前、cell にルールの id を置く（版の署名でどのルールを承認するかを、橋渡しがこれで照らす） */
export const PLAN_RULE_SOURCE = "rule:計画ルール";
/** 自施設の実績の間隔（MOYAI が計画から数えたもの）を根拠にした案の出どころ */
export const RECORD_SOURCE = "record:自施設の実績";
/** パックの基準（checks.json の検査）を根拠にした案の出どころ。sheet に検査の ID を置く */
export const PACK_SOURCE = "pack:パックの基準";
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

/** 計画ルールの状態（根拠の行に出す。人が受ける前に、承認済みか未承認の下書きかが分かるように。Architect の 42 の答え 1） */
export function planRuleStatus(from: { approved: boolean; draft: boolean }): string {
  return from.approved && !from.draft ? "承認済み" : from.draft ? "未承認の下書き" : "未承認";
}

/** 計画ルールの根拠の行：「計画ルール「名前」版 xxxx xxxx（承認済み）：1 文」（下書きは版「―」） */
export function planRuleLine(name: string, version: string, status: string, text: string): string {
  return `計画ルール「${name}」版 ${shortVersion(version)}（${status}）：${text}`;
}

/** 計画ルールの出どころ（どのルールから出した案か） */
export const planRuleSourceRef = (name: string, ruleId: string): SourceRef => ({ file: PLAN_RULE_SOURCE, sheet: name, page: null, cell: ruleId, box: null });
const sourceRef = (file: string, sheet: string | null = null): SourceRef => ({ file, sheet, page: null, cell: null, box: null });

/** MOYAI が照らした根拠（AI が書いた数は使わない。橋渡し・作業画面が計画・パック・保管先から引いたもの） */
export interface VerifiedBases {
  /** 自施設の実績の間隔を数える（AI は「使う」と指すだけ。間隔は当たった作業の実績の年度から数える） */
  record?: boolean;
  /** パックの基準：検査の ID・名前・出典 */
  pack?: { checkId: string; name: string; source: string };
  /** 計画ルール：名前・版・ルールの id・1 文 */
  rule?: { name: string; version: string; ruleId: string; text: string; status: string };
}

/** 当たった作業の実績の間隔（年度の差）。実施が 2 回以上ある作業だけを数える。無ければ null */
export function recordIntervals(details: readonly WorkDetailT[], works: readonly WorkT[]): { works: number; min: number; max: number } | null {
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const w of works) {
    const ys = [...new Set(details.filter((d) => d.workKey === w.workKey && d.planOrActual === "actual").map((d) => d.fiscalYear))].sort((a, b) => a - b);
    if (ys.length < 2) continue;
    n++;
    for (let i = 1; i < ys.length; i++) {
      min = Math.min(min, ys[i]! - ys[i - 1]!);
      max = Math.max(max, ys[i]! - ys[i - 1]!);
    }
  }
  return n === 0 ? null : { works: n, min, max };
}

const span = (a: number, b: number) => (a === b ? `${a} 年` : `${a}〜${b} 年`);

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

export function proposeCycles(
  plan: Plan,
  rules: Rule[],
  opts: {
    nextId: () => string;
    basis: string;
    /** 橋渡しが台帳の版と似た施設 5 以上を照らした案か。照らした案だけ出どころを台帳にする（中-5 の残り） */
    fromLedger: boolean;
    /** 台帳を照らしていない案の作者（会話から写した利用者の答えか、Claude の決定） */
    author?: "ai" | "ai_relayed_human";
    /** MOYAI が照らした根拠（自施設の実績・パックの基準・計画ルール）。照らせたものだけ出どころに足す */
    verified?: VerifiedBases;
    /** 計画ルールから出す案：出どころは計画ルール（sheet に名前、cell に id） */
    planRule?: { name: string; ruleId: string };
    /** 当てる作業を絞る（計画ルールは、項目と属性を人が受けた作業だけ） */
    onlyWorks?: (w: WorkT) => boolean;
  },
): CycleOutcome {
  const author = opts.fromLedger ? "ai" : (opts.author ?? "ai");
  for (const [i, r] of rules.entries()) if (cycleYearsOf(r) === null) return { ok: false, code: "rule_invalid", ruleIndex: i };
  const horizon = plan.details.reduce((m, d) => Math.max(m, d.fiscalYear), -Infinity);
  const details: WorkDetailT[] = [...plan.details];
  const proposals: CycleProposal[] = [];
  for (const rule of rules) {
    const years = cycleYearsOf(rule)!;
    const id = opts.nextId();
    const hit = worksHitBy(plan, rule).filter((w) => !opts.onlyWorks || opts.onlyWorks(w));
    // 出どころと、照らした根拠の文（照らせたものだけ。どれも照らせなければ会話。中-5 と同じ）
    const v = opts.verified ?? {};
    const sources: SourceRef[] = [];
    const lines: string[] = [];
    if (opts.planRule) sources.push(planRuleSourceRef(opts.planRule.name, opts.planRule.ruleId));
    if (opts.fromLedger) sources.push(sourceRef(LEDGER_SOURCE));
    const rec = v.record ? recordIntervals(details, hit) : null;
    if (rec) {
      sources.push(sourceRef(RECORD_SOURCE));
      lines.push(`自施設の実績：実施が 2 回以上の作業 ${rec.works} の間隔 ${span(rec.min, rec.max)}`);
    }
    if (v.pack) {
      sources.push(sourceRef(PACK_SOURCE, v.pack.checkId));
      lines.push(`パックの基準「${v.pack.name}」（${v.pack.checkId}。出典 ${v.pack.source}）`);
    }
    if (v.rule) {
      sources.push(planRuleSourceRef(v.rule.name, v.rule.ruleId));
      lines.push(planRuleLine(v.rule.name, v.rule.version, v.rule.status, v.rule.text));
    }
    if (sources.length === 0) sources.push(sourceRef(CONVERSATION_SOURCE));
    const basis = `${opts.basis}（案 ${id}：${years} 年ごと。${rule.reason}）${lines.map((x) => `。${x}`).join("")}`;
    const p: CycleProposal = { id, years, basis, detailKeys: [], works: 0, skipped: { noActual: 0, noHorizon: 0 } };
    for (const w of hit) {
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
          sources: sources.map((x) => ({ ...x })),
          basis,
          author,
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
