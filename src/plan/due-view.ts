// 次回の見せ方（台帳の重-8b。docs/screens.md 3.2・3.5、言葉は Wire）：next.ts の答えを、星取表の「次回」の列・横の明細・Excel の 4 列の字にする。
// 画面と Excel は同じ字を使う（言葉はここだけ）。純粋な関数。
// - 列の字は起点の粒度で出す：起点が日付なら日付、年度単位・使用開始なら次回の年度（「2027 年度」）。決まらないときは「―」
// - 1 つの行に作業がいくつもあるときは、決まった次回のうちいちばん早いもの（無ければ最初の作業の決まらない理由）
import type { Plan } from "../shared/plan";
import { fiscalYearOf } from "./chart";
import { planDue, type WorkDue } from "./next";
import type { DueNote, MeterWhy } from "./trigger";

export const DUE_TEXT = {
  col: "次回",
  none: "―",
  fy: (y: number) => `${y} 年度`,
  side: { due: "次回", latest: "期限", window: "許容幅", basis: "根拠", origin: "起点", notes: "備考" },
  exportCols: ["次回", "期限", "根拠", "備考"] as const,
  calendar: "暦",
  projected: (meter: string) => `${meter}（見込み）`,
  originGrain: { fiscalYear: "年度単位", start: "使用開始" },
  windowRange: (from: string, to: string) => `${from}〜${to}`,
  notes: {
    calendarOnly: "暦のみ（使用量なし）",
    firstCycle: "初回",
    pauseCapped: "休止を上限まで加算",
    extended: "延長",
    extensionCapped: "延長上限",
    extensionUnapproved: "延長未承認",
  } satisfies Record<DueNote, string>,
  undecided: {
    noTrigger: "起点なし",
    triggerInvalid: "起点不正",
    noOrigin: "起点なし",
    meterNone: "使用量不足",
    meterInsufficient: "使用量不足",
    meterDecreasing: "使用量が減少",
    meterNotGrowing: "使用量の変化なし",
  } satisfies Record<"noTrigger" | "triggerInvalid" | "noOrigin" | MeterWhy, string>,
  sep: "・",
};

export interface DueView {
  workKey: string;
  decided: boolean;
  /** 次回の日（決まらなければ null。いちばん早いものを選ぶのに使う） */
  dueDate: string | null;
  /** 列の字（次回） */
  text: string;
  /** 期限（幅のある周期・延長のときだけ） */
  latest: string | null;
  /** 許容幅（窓のときだけ） */
  window: string | null;
  /** 根拠（暦・計量値の名前） */
  basis: string | null;
  /** 起点（年度単位・使用開始を添える） */
  origin: string | null;
  /** 備考（出し方の印と、決まらない理由） */
  notes: string;
}

/** 1 つの作業の次回を字にする */
export function dueView(w: WorkDue, fiscalYearStartMonth: number): DueView {
  const T = DUE_TEXT;
  const blank = { latest: null, window: null, basis: null, origin: null, dueDate: null };
  if (w.status !== "due") return { workKey: w.workKey, decided: false, text: T.none, ...blank, notes: T.undecided[w.status] };
  const grain = w.originGrain;
  const byYear = grain === "fiscalYear" || grain === "start";
  const show = (d: string) => (byYear ? T.fy(fiscalYearOf(d, fiscalYearStartMonth)) : d);
  const origin =
    w.origin === null ? null : grain === "fiscalYear" ? `${T.fy(fiscalYearOf(w.origin, fiscalYearStartMonth))}（${T.originGrain.fiscalYear}）` : grain === "start" ? `${w.origin}（${T.originGrain.start}）` : w.origin;
  const b = w.by !== null ? w.branches[w.by] : undefined;
  const basis = !b ? null : b.kind === "calendar" ? T.calendar : b.due !== null ? T.projected(b.meter) : b.meter;
  const notes = w.notes.map((n) => T.notes[n]);
  if (w.due === null) {
    // 決まらない理由：起点が無い、または計量値の枝が読めない（暦の枝が無いとき）
    const why = w.origin === null ? [T.undecided.noOrigin] : w.branches.flatMap((x) => (x.kind === "meter" && x.due === null ? [T.undecided[x.why]] : []));
    return { workKey: w.workKey, decided: false, text: T.none, ...blank, origin, notes: [...new Set([...why, ...notes])].join(T.sep) };
  }
  return {
    workKey: w.workKey,
    decided: true,
    dueDate: w.due,
    text: show(w.due),
    latest: w.latest && w.latest !== w.due ? show(w.latest) : null,
    window: w.window ? T.windowRange(w.window.from, w.window.to) : null,
    basis,
    origin,
    notes: notes.join(T.sep),
  };
}

/** 計画のすべての作業の次回の字 */
export function planDueViews(plan: Plan, today: string): Map<string, DueView> {
  const out = new Map<string, DueView>();
  for (const [k, w] of planDue(plan, today)) out.set(k, dueView(w, plan.facility.fiscalYearStartMonth));
  return out;
}

/** 1 つの行の次回：決まった次回のうちいちばん早いもの。どれも決まらなければ最初の作業のもの。作業が無ければ null */
export function rowDue(works: readonly string[] | undefined, views: ReadonlyMap<string, DueView>): DueView | null {
  const vs = (works ?? []).map((k) => views.get(k)).filter((v): v is DueView => !!v);
  if (vs.length === 0) return null;
  const decided = vs.filter((v) => v.decided).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
  return decided[0] ?? vs[0]!;
}
