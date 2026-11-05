// きっかけの性質の試験（docs/plan.md §2.4・§5.1 trigger.property。台帳の重-8）：どの群の周期も同じ関数で書ける。
// 早い方・窓・初回・休止・延長・範囲・計量値の見込みと、鉄道（km）・火力（運転時間と起動回数）・船舶（前後の窓）・昇降機と消防（法定の月）・ごみ焼却（号炉の運転時間と暦の早い方）。パックもサンプルも作らない
import { describe, expect, test } from "vitest";
import { addMonths, nextDue, type MeterReading } from "../../src/plan/trigger";

/** 毎月の 1 日に、1 日あたり rate ずつ増えた計量値（from から n か月分） */
function monthly(meter: string, from: string, n: number, start: number, perDay: number): MeterReading[] {
  const out: MeterReading[] = [];
  for (let i = 0; i <= n; i++) {
    const date = addMonths(from, i);
    const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    out.push({ meter, date, value: start + days * perDay });
  }
  return out;
}

describe("きっかけ：暦と計量値の早い方", () => {
  test("暦の足し算は月末をそろえる", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2020-04-01", 36)).toBe("2023-04-01");
  });

  test("ごみ焼却：号炉の運転時間 8,000 時間と暦 1 年の早い方。よく回る炉は運転時間で先に来る（見込み）", () => {
    const readings = monthly("hours", "2025-04-01", 12, 10_000, 24);
    const r = nextDue({ branches: [{ kind: "calendar", years: 1 }, { kind: "meter", meter: "hours", every: 8_000 }], combine: "earliest" }, { lastDone: "2025-04-01", start: null, readings, today: "2026-04-01" });
    expect(r.branches[0]).toEqual({ kind: "calendar", due: "2026-04-01" });
    expect(r.branches[1]).toMatchObject({ kind: "meter", projected: true });
    // 1 日 24 時間で 8,000 時間は 334 日後
    expect(r.due).toBe("2026-03-01");
    expect(r.by).toBe(1);
  });

  test("鉄道：走行 50,000 km と暦 1 年の早い方。走らない車は暦で来る", () => {
    const slow = monthly("km", "2025-01-01", 12, 0, 50);
    const r = nextDue({ branches: [{ kind: "meter", meter: "km", every: 50_000 }, { kind: "calendar", years: 1 }], combine: "earliest" }, { lastDone: "2025-01-01", start: null, readings: slow, today: "2026-01-01" });
    expect(r.by).toBe(1);
    expect(r.due).toBe("2026-01-01");
  });

  test("火力：運転時間と起動回数のどちらか早い方。起動の多い機は起動回数で来る", () => {
    const readings = [...monthly("hours", "2025-01-01", 12, 0, 10), ...monthly("starts", "2025-01-01", 12, 0, 2)];
    const r = nextDue({ branches: [{ kind: "meter", meter: "hours", every: 25_000 }, { kind: "meter", meter: "starts", every: 300 }], combine: "earliest" }, { lastDone: "2025-01-01", start: null, readings, today: "2026-01-01" });
    expect(r.by).toBe(1);
    expect(r.due).toBe("2025-05-31");
  });

  test("船舶：暦 5 年に前後 3 か月の窓", () => {
    const r = nextDue({ branches: [{ kind: "calendar", years: 5 }], combine: "earliest", window: { before: 92, after: 92 } }, { lastDone: "2021-06-15", start: null, readings: [], today: "2026-01-01" });
    expect(r.due).toBe("2026-06-15");
    expect(r.window).toEqual({ from: "2026-03-15", to: "2026-09-15" });
  });

  test("昇降機・消防：法定の月の周期（1 か月・6 か月）。前回が無ければ使用開始から", () => {
    expect(nextDue({ branches: [{ kind: "calendar", months: 1 }], combine: "earliest" }, { lastDone: "2026-01-31", start: null, readings: [], today: "2026-02-01" }).due).toBe("2026-02-28");
    expect(nextDue({ branches: [{ kind: "calendar", months: 6 }], combine: "earliest" }, { lastDone: null, start: "2025-10-01", readings: [], today: "2026-01-01" }).due).toBe("2026-04-01");
  });

  test("全部：どの枝も来たら。どれかが決まらなければ決めない（推測で埋めない）", () => {
    const readings = monthly("hours", "2025-01-01", 12, 0, 24);
    const t = { branches: [{ kind: "calendar" as const, years: 2 }, { kind: "meter" as const, meter: "hours", every: 8_000 }], combine: "all" as const };
    expect(nextDue(t, { lastDone: "2025-01-01", start: null, readings, today: "2026-01-01" })).toMatchObject({ due: "2027-01-01", by: 0 });
    // 記録が 1 点だけ（足りない）なら、全部は決めない
    expect(nextDue(t, { lastDone: "2025-01-01", start: null, readings: [{ meter: "hours", date: "2025-06-01", value: 10 }], today: "2026-01-01" })).toMatchObject({ due: null, by: null });
  });

  test("使用量の値が無い施設：計量値の枝は数えず、暦だけで出して「暦だけ」と返す（早い方でも全部でも。推測で埋めない）", () => {
    for (const combine of ["earliest", "all"] as const) {
      const r = nextDue({ branches: [{ kind: "meter", meter: "hours", every: 8_000 }, { kind: "calendar", years: 1 }], combine }, { lastDone: "2025-04-01", start: null, readings: [], today: "2026-01-01" });
      expect(r).toMatchObject({ due: "2026-04-01", by: 1 });
      expect(r.notes).toContain("calendarOnly");
      expect(r.branches[0]).toMatchObject({ kind: "meter", due: null, why: "meterNone" });
    }
    // 暦の枝が無ければ決めない
    expect(nextDue({ branches: [{ kind: "meter", meter: "hours", every: 8_000 }], combine: "earliest" }, { lastDone: "2025-04-01", start: null, readings: [], today: "2026-01-01" }).due).toBeNull();
  });

  test("初回だけの周期：前回が無ければ使用開始から初回の周期、前回があればふだんの周期", () => {
    const t = { branches: [{ kind: "calendar" as const, years: 4 }], combine: "earliest" as const, first: { years: 2 } };
    const r = nextDue(t, { lastDone: null, start: "2024-04-01", readings: [], today: "2025-01-01" });
    expect(r.due).toBe("2026-04-01");
    expect(r.notes).toContain("firstCycle");
    expect(nextDue(t, { lastDone: "2026-04-01", start: "2024-04-01", readings: [], today: "2027-01-01" }).due).toBe("2030-04-01");
  });

  test("休止を数えない：起点のあとの休止の日だけ延ばし、上限で止める。起点より前の休止は数えない", () => {
    const base = { branches: [{ kind: "calendar" as const, years: 1 }], combine: "earliest" as const };
    const pauses = [{ from: "2025-07-01", to: "2025-07-30" }, { from: "2024-01-01", to: "2024-12-31" }];
    const r = nextDue({ ...base, pauseCap: { months: 6 } }, { lastDone: "2025-04-01", start: null, readings: [], today: "2025-08-01", pauses });
    expect(r.due).toBe("2026-05-01");
    expect(r.branches[0]).toMatchObject({ pausedDays: 30 });
    // 延ばした先にかかる休止も数える
    const chain = nextDue({ ...base, pauseCap: { months: 6 } }, { lastDone: "2025-04-01", start: null, readings: [], today: "2025-08-01", pauses: [{ from: "2025-07-01", to: "2025-07-30" }, { from: "2026-04-15", to: "2026-04-24" }] });
    expect(chain.due).toBe("2026-05-11");
    // 長い休止は上限まで
    const capped = nextDue({ ...base, pauseCap: { months: 1 } }, { lastDone: "2025-04-01", start: null, readings: [], today: "2025-08-01", pauses: [{ from: "2025-05-01", to: "2025-10-31" }] });
    expect(capped.due).toBe("2026-05-01");
    expect(capped.notes).toContain("pauseCapped");
  });

  test("延長：承認があるものだけ、上限まで効かせる。承認が無ければ効かせず印を返す", () => {
    const t = { branches: [{ kind: "calendar" as const, years: 3 }], combine: "earliest" as const, extensionCap: { months: 12 } };
    const ctx = { lastDone: "2023-06-01", start: null, readings: [], today: "2026-01-01" };
    expect(nextDue(t, { ...ctx, extension: { months: 6, approved: true } })).toMatchObject({ due: "2026-12-01", notes: ["extended"] });
    const over = nextDue(t, { ...ctx, extension: { months: 24, approved: true } });
    expect(over.due).toBe("2027-06-01");
    expect(over.notes).toEqual(expect.arrayContaining(["extended", "extensionCapped"]));
    const no = nextDue(t, { ...ctx, extension: { months: 6, approved: false } });
    expect(no.due).toBe("2026-06-01");
    expect(no.notes).toEqual(["extensionUnapproved"]);
    // 上限の無いトリガーは延ばさない
    expect(nextDue({ ...t, extensionCap: undefined }, { ...ctx, extension: { months: 6, approved: true } }).due).toBe("2026-06-01");
  });

  test("範囲（幅のある周期）：3〜5 年ごとは、早くて 3 年後、遅くとも 5 年後", () => {
    const r = nextDue({ branches: [{ kind: "calendar", years: 3, upTo: { years: 5 } }], combine: "earliest" }, { lastDone: "2022-10-01", start: null, readings: [], today: "2026-01-01" });
    expect(r).toMatchObject({ due: "2025-10-01", latest: "2027-10-01" });
  });

  test("計量値が 2 点に満たない・減った・増えていないときは理由を返し、その枝で決めない", () => {
    const t = { branches: [{ kind: "meter" as const, meter: "hours", every: 100 }], combine: "earliest" as const };
    const ctx = { lastDone: "2025-01-01", start: null, today: "2026-01-01" };
    expect(nextDue(t, { ...ctx, readings: [{ meter: "hours", date: "2025-06-01", value: 10 }] }).branches[0]).toMatchObject({ why: "meterInsufficient" });
    expect(nextDue(t, { ...ctx, readings: [{ meter: "hours", date: "2025-06-01", value: 10 }, { meter: "hours", date: "2025-07-01", value: 5 }] }).branches[0]).toMatchObject({ why: "meterDecreasing" });
    expect(nextDue(t, { ...ctx, readings: [{ meter: "hours", date: "2025-06-01", value: 10 }, { meter: "hours", date: "2025-07-01", value: 10 }] }).branches[0]).toMatchObject({ why: "meterNotGrowing" });
    expect(nextDue(t, { ...ctx, readings: [] }).branches[0]).toMatchObject({ why: "meterNone" });
    expect(nextDue(t, { ...ctx, readings: [] }).due).toBeNull();
  });

  test("起点が無ければ暦の枝は決めない", () => {
    expect(nextDue({ branches: [{ kind: "calendar", years: 1 }], combine: "earliest" }, { lastDone: null, start: null, readings: [], today: "2026-01-01" }).due).toBeNull();
  });
});
