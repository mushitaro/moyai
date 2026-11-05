// 作業ごとの次回（docs/plan.md §2.4。台帳の重-8b）：計画の作業のきっかけ（work.trigger）と、その作業の実績と、計量値の記録から、
// trigger.ts の nextDue で次回を出す。星取表・Excel・差分は、ここの答えを読む（同じ計算を 2 か所に持たない）。
// - 起点は、その作業の最後の実施。日付が無い年度だけの印は、その年度の始まりの日を起点にし、「年度の粒度」と返す。
//   実施が無ければ、対象の機器の設置の日のうちいちばん早いもの（使用開始）。
// - 計量値の記録は、計画の meters のうち、作業の対象の機器のもの。無ければ、計量値の枝は数えず暦だけ（calendarOnly）。
// - きっかけの形が読めない作業は、決めずに数える（推測で埋めない）。
import { z } from "zod";
import type { Plan, WorkT } from "../shared/plan";
import { nextDue, type DueResult, type MeterReading, type Trigger } from "./trigger";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const span = { years: z.number().int().min(0).max(100).optional(), months: z.number().int().min(0).max(1200).optional() };
const Span = z.object(span).strict();

/** 計画に置くきっかけの形（trigger.ts の Trigger と同じ） */
export const TriggerSchema = z
  .object({
    branches: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("calendar"), ...span, upTo: Span.optional() }).strict(),
          z.object({ kind: z.literal("meter"), meter: z.string().min(1).max(40), every: z.number().positive() }).strict(),
        ]),
      )
      .min(1)
      .max(8),
    combine: z.enum(["earliest", "all"]),
    first: Span.optional(),
    window: z.object({ before: z.number().int().min(0), after: z.number().int().min(0) }).strict().optional(),
    pauseCap: Span.optional(),
    extensionCap: Span.optional(),
  })
  .strict();

export type WorkDue =
  | { workKey: string; status: "noTrigger" }
  | { workKey: string; status: "triggerInvalid" }
  | ({ workKey: string; status: "due"; origin: string | null; originGrain: "date" | "fiscalYear" | "start" | null } & DueResult);

/** その年度の始まりの日（年度の始まりの月は施設が持つ） */
function fiscalYearStart(fy: number, startMonth: number): string {
  return `${String(fy).padStart(4, "0")}-${String(startMonth).padStart(2, "0")}-01`;
}

const later = (a: string | null, b: string) => (a === null || a < b ? b : a);

/** 1 つの作業の次回 */
export function workDue(plan: Plan, w: WorkT, today: string): WorkDue {
  if (w.trigger === null || w.trigger === undefined) return { workKey: w.workKey, status: "noTrigger" };
  const t = TriggerSchema.safeParse(w.trigger);
  if (!t.success) return { workKey: w.workKey, status: "triggerInvalid" };
  let last: string | null = null;
  let grain: "date" | "fiscalYear" | null = null;
  for (const d of plan.details) {
    if (d.workKey !== w.workKey || d.planOrActual !== "actual") continue;
    const at = d.startDate && DATE.safeParse(d.startDate).success ? d.startDate : fiscalYearStart(d.fiscalYear, plan.facility.fiscalYearStartMonth);
    if (at > today) continue;
    const next = later(last, at);
    if (next !== last) grain = d.startDate ? "date" : "fiscalYear";
    last = next;
  }
  const targets = new Set(w.targets);
  const starts = plan.assets.filter((a) => targets.has(a.nodeKey) && a.installedOn && DATE.safeParse(a.installedOn).success).map((a) => a.installedOn!);
  const start = starts.length ? starts.sort()[0]! : null;
  const meters = (plan.meters ?? []).filter((m) => targets.has(m.nodeKey));
  const readings: MeterReading[] = meters.map((m) => ({ meter: m.meter, date: m.date, value: m.value }));
  const r = nextDue(t.data as Trigger, { lastDone: last, start, readings, today });
  return { workKey: w.workKey, status: "due", origin: last ?? start, originGrain: last ? grain : start ? "start" : null, ...r };
}

/** 計画のすべての作業の次回（きっかけの無い作業も、無いと返す） */
export function planDue(plan: Plan, today: string): Map<string, WorkDue> {
  return new Map(plan.works.map((w) => [w.workKey, workDue(plan, w, today)]));
}
