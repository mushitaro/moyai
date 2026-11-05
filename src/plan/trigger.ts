// きっかけ（docs/plan.md §2.4。台帳の重-8）：作業の次回を、暦の枝と計量値の枝から出す純粋な関数。
// - 枝：暦（n 年・n か月ごと。幅のある周期は「upTo まで」）と計量値（運転時間・起動回数・走行距離などを n ごと）。
//   まとめ方は早い方（どれか 1 つ）か全部（どれも）。
// - 起点：前回の実施（無ければ使用開始）。初回だけの周期（前回が無いとき）。前後の窓（その前後なら同じ回と見る）。
// - 休止：暦の枝は、起点から後の休止の日を数えない（延ばす）。延ばすのは上限まで。
// - 延長：承認の記録がある延長だけを、上限まで効かせる。承認の無い延長は効かせず、印を返す。
// - 計量値の枝の次回は、直近 12 か月の増え方から見込み、「見込み」と返す。記録が 2 点に満たなければ「計量値が足りない」。
//   その計量値の記録が 1 つも無ければ、その枝は数えず、暦の枝だけで出して「使用量の値が無い」と返す（推測で埋めない）。
// - 業種の言葉は持たない（計量値の名前はパックと計画が持つ）。日付は時刻帯の無い YYYY-MM-DD の文字。
export interface Span {
  years?: number;
  months?: number;
}

export type TriggerBranch =
  | ({ kind: "calendar"; upTo?: Span } & Span)
  | { kind: "meter"; meter: string; every: number };

export interface Trigger {
  branches: TriggerBranch[];
  /** earliest：どれか 1 つが来たら。all：どれも来たら */
  combine: "earliest" | "all";
  /** 初回だけの周期（前回の実施が無いとき、暦の枝はこれを使う） */
  first?: Span;
  /** その前後なら同じ回と見る窓（日） */
  window?: { before: number; after: number };
  /** 休止を数えないとき、延ばしてよい上限 */
  pauseCap?: Span;
  /** 承認による延長の上限 */
  extensionCap?: Span;
}

/** 計量値の記録（資産か施設ごとの日付つきの値） */
export interface MeterReading {
  meter: string;
  date: string;
  value: number;
}

export interface TriggerContext {
  lastDone: string | null;
  start: string | null;
  readings: readonly MeterReading[];
  today: string;
  /** 休止の期間（両端を含む） */
  pauses?: readonly { from: string; to: string }[];
  /** 延長（approved が無ければ効かせない） */
  extension?: { months: number; approved: boolean };
}

export type MeterWhy = "meterNone" | "meterInsufficient" | "meterDecreasing" | "meterNotGrowing";

export type BranchDue =
  | { kind: "calendar"; due: string | null; latest?: string; pausedDays?: number }
  | { kind: "meter"; meter: string; due: string; projected: true; ratePerDay: number }
  | { kind: "meter"; meter: string; due: null; why: MeterWhy };

export type DueNote = "calendarOnly" | "pauseCapped" | "extended" | "extensionCapped" | "extensionUnapproved" | "firstCycle";

export interface DueResult {
  /** 次回（決まらなければ null） */
  due: string | null;
  /** 遅くともこの日まで（幅のある周期・延長のとき。無ければ due と同じ） */
  latest: string | null;
  /** 次回を決めた枝の番号（決まらなければ null） */
  by: number | null;
  /** 次回の前後の窓 */
  window: { from: string; to: string } | null;
  branches: BranchDue[];
  /** 出し方の印（画面と検査が根拠に出す） */
  notes: DueNote[];
}

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const months = (s: Span) => (s.years ?? 0) * 12 + (s.months ?? 0);
const addDays = (d: string, n: number) => toDate(toTime(d) + n * DAY);

/** 暦の足し算（月末は月末にそろえる。1 月 31 日 + 1 か月 → 2 月の末） */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** 直近 12 か月の増え方（1 日あたり）。記録が無い・2 点に満たない・減った・増えていないときは理由 */
function rateOf(readings: readonly MeterReading[], meter: string, today: string): { rate: number; last: MeterReading } | { why: MeterWhy } {
  const rs = readings.filter((r) => r.meter === meter && toTime(r.date) <= toTime(today)).sort((a, b) => toTime(a.date) - toTime(b.date));
  if (rs.length === 0) return { why: "meterNone" };
  for (let i = 1; i < rs.length; i++) if (rs[i]!.value < rs[i - 1]!.value) return { why: "meterDecreasing" };
  const from = toTime(addMonths(today, -12));
  const recent = rs.filter((r) => toTime(r.date) >= from);
  const use = recent.length >= 2 ? recent : rs.slice(-2);
  if (use.length < 2) return { why: "meterInsufficient" };
  const a = use[0]!;
  const b = use[use.length - 1]!;
  const days = (toTime(b.date) - toTime(a.date)) / DAY;
  if (days <= 0 || b.value <= a.value) return { why: "meterNotGrowing" };
  return { rate: (b.value - a.value) / days, last: b };
}

/** その日の計量値（記録の間は直線で見る。記録より前なら最初の記録、あとなら null） */
function valueAt(readings: readonly MeterReading[], meter: string, date: string): number | null {
  const rs = readings.filter((r) => r.meter === meter).sort((a, b) => toTime(a.date) - toTime(b.date));
  if (rs.length === 0) return null;
  const t = toTime(date);
  if (t <= toTime(rs[0]!.date)) return rs[0]!.value;
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1]!;
    const b = rs[i]!;
    if (t <= toTime(b.date)) return a.value + ((b.value - a.value) * (t - toTime(a.date))) / (toTime(b.date) - toTime(a.date));
  }
  return null;
}

/** [from, to] と休止の重なりの日数（両端を含む） */
function overlapDays(pauses: readonly { from: string; to: string }[], from: string, to: string): number {
  let n = 0;
  for (const p of pauses) {
    const a = Math.max(toTime(p.from), toTime(from));
    const b = Math.min(toTime(p.to), toTime(to));
    if (b >= a) n += (b - a) / DAY + 1;
  }
  return n;
}

/** 休止の日を数えず延ばす（延ばした先にかかる休止も数える）。上限があれば止める */
function skipPauses(origin: string, due: string, pauses: readonly { from: string; to: string }[], cap: string | null): { due: string; days: number; capped: boolean } {
  let cur = due;
  for (let i = 0; i < 32; i++) {
    const days = overlapDays(pauses, addDays(origin, 1), cur);
    const next = addDays(due, days);
    if (cap && toTime(next) > toTime(cap)) return { due: cap, days: (toTime(cap) - toTime(due)) / DAY, capped: true };
    if (next === cur) return { due: cur, days, capped: false };
    cur = next;
  }
  return { due: cur, days: (toTime(cur) - toTime(due)) / DAY, capped: false };
}

/**
 * 次回を出す。起点は前回の実施（無ければ使用開始）。起点が無ければ暦の枝は決めない。
 * 計量値の枝は、起点の日の値に「ごと」を足した値に届く日を、直近の増え方から見込む
 */
export function nextDue(t: Trigger, ctx: TriggerContext): DueResult {
  const origin = ctx.lastDone ?? ctx.start;
  const firstCycle = !ctx.lastDone && !!t.first;
  const notes = new Set<DueNote>();
  const branches: BranchDue[] = t.branches.map((b) => {
    if (b.kind === "calendar") {
      if (!origin) return { kind: "calendar", due: null };
      const span = firstCycle ? t.first! : b;
      let due = addMonths(origin, months(span));
      let latest = b.upTo && !firstCycle ? addMonths(origin, months(b.upTo)) : undefined;
      let pausedDays: number | undefined;
      if (ctx.pauses?.length) {
        const s = skipPauses(origin, due, ctx.pauses, t.pauseCap ? addMonths(due, months(t.pauseCap)) : null);
        if (s.days > 0) {
          pausedDays = s.days;
          due = s.due;
          if (latest) latest = addDays(latest, s.days);
        }
        if (s.capped) notes.add("pauseCapped");
      }
      return { kind: "calendar", due, ...(latest ? { latest } : {}), ...(pausedDays ? { pausedDays } : {}) };
    }
    const r = rateOf(ctx.readings, b.meter, ctx.today);
    if ("why" in r) return { kind: "meter", meter: b.meter, due: null, why: r.why };
    const base = origin ? (valueAt(ctx.readings, b.meter, origin) ?? r.last.value) : r.last.value;
    const days = (base + b.every - r.last.value) / r.rate;
    return { kind: "meter", meter: b.meter, due: toDate(toTime(r.last.date) + Math.ceil(days) * DAY), projected: true, ratePerDay: r.rate };
  });
  if (firstCycle) notes.add("firstCycle");
  // 記録の無い計量値の枝は数えない（暦の枝だけで出す）
  const counted = branches.map((b, i) => ({ b, i })).filter(({ b }) => !(b.kind === "meter" && b.due === null && b.why === "meterNone"));
  if (counted.length < branches.length && counted.some(({ b }) => b.kind === "calendar")) notes.add("calendarOnly");
  const dues = counted.filter((x): x is { b: BranchDue & { due: string }; i: number } => !!x.b.due);
  // 全部のときは、数える枝のどれかが決まらなければ決めない（推測で埋めない）
  if (dues.length === 0 || (t.combine === "all" && dues.length < counted.length)) return { due: null, latest: null, by: null, window: null, branches, notes: [...notes] };
  const pick = dues.reduce((p, x) => ((t.combine === "earliest" ? toTime(x.b.due) < toTime(p.b.due) : toTime(x.b.due) > toTime(p.b.due)) ? x : p));
  let due = pick.b.due;
  let latest = pick.b.kind === "calendar" && pick.b.latest ? pick.b.latest : due;
  if (ctx.extension && ctx.extension.months > 0) {
    if (!ctx.extension.approved) notes.add("extensionUnapproved");
    else {
      const capM = t.extensionCap ? months(t.extensionCap) : 0;
      const m = Math.min(ctx.extension.months, capM);
      if (m < ctx.extension.months) notes.add("extensionCapped");
      if (m > 0) {
        notes.add("extended");
        due = addMonths(due, m);
        latest = toTime(latest) > toTime(due) ? latest : due;
      }
    }
  }
  const window = t.window ? { from: addDays(due, -t.window.before), to: addDays(due, t.window.after) } : null;
  return { due, latest, by: pick.i, window, branches, notes: [...notes] };
}
