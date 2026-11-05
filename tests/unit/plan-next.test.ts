// 作業ごとの次回（docs/plan.md §2.4・§5.1 cross-layer の計画の側。台帳の重-8b）：計画のきっかけと実績から、trigger.ts の nextDue で次回を出す。
// 実績が足されると次回が動く。年度だけの印は年度の始まりを起点にして「年度の粒度」。計量値が無ければ暦だけ。形の読めないきっかけは決めない
import { describe, expect, it } from "vitest";
import { planDue, workDue } from "../../src/plan/next";
import { Plan } from "../../src/shared/plan";
import { asset, detail, plan, work } from "./share/fixtures";

const calendar3 = { branches: [{ kind: "calendar", years: 3 }], combine: "earliest" };
const hoursOr3 = { branches: [{ kind: "meter", meter: "hours", every: 8000 }, { kind: "calendar", years: 3 }], combine: "earliest" };

describe("作業ごとの次回", () => {
  it("年度だけの実績は年度の始まりを起点に。日付のある実績が足されると次回が動く（取り込んだ実績で次回が動く）", () => {
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [detail("d1", "w1", 2022)] });
    expect(workDue(p, p.works[0]!, "2026-01-01")).toMatchObject({ status: "due", due: "2025-04-01", origin: "2022-04-01", originGrain: "fiscalYear", by: 0 });
    const p2 = { ...p, details: [...p.details, detail("d2", "w1", 2024, { startDate: "2024-07-10" })] };
    expect(workDue(p2, p2.works[0]!, "2026-01-01")).toMatchObject({ due: "2027-07-10", origin: "2024-07-10", originGrain: "date" });
    // 計画の印は起点にしない。今日より後の実績も起点にしない
    const p3 = { ...p2, details: [...p2.details, detail("d3", "w1", 2027, { planOrActual: "plan" }), detail("d4", "w1", 2026, { startDate: "2026-09-01" })] };
    expect(workDue(p3, p3.works[0]!, "2026-01-01")).toMatchObject({ due: "2027-07-10" });
  });

  it("実績が無ければ、対象の機器の設置の日（使用開始）から。どちらも無ければ決めない", () => {
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT", { installedOn: "2020-10-01" }), asset("a2", "T.FEED.LIFT", { installedOn: "2019-06-01" })], works: [work("w1", "OVERHAUL", ["a1", "a2"], { trigger: calendar3 })], details: [] });
    expect(workDue(p, p.works[0]!, "2026-01-01")).toMatchObject({ due: "2022-06-01", origin: "2019-06-01", originGrain: "start" });
    const q = plan({ assets: [asset("a1", "T.FEED.LIFT", { installedOn: null })], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [] });
    expect(workDue(q, q.works[0]!, "2026-01-01")).toMatchObject({ due: null, origin: null, originGrain: null });
  });

  it("号炉の運転時間と暦の早い方：計量値の記録が無ければ暦だけで出して calendarOnly、あれば見込みで先に来る", () => {
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger: hoursOr3 })], details: [detail("d1", "w1", 2024, { startDate: "2024-04-01" })] });
    const none = workDue(p, p.works[0]!, "2025-04-01");
    expect(none).toMatchObject({ due: "2027-04-01", by: 1 });
    if (none.status !== "due") throw new Error(none.status);
    expect(none.notes).toContain("calendarOnly");
    // 1 日 24 時間（対象の機器の記録だけを読む。ほかの機器の記録は読まない）
    const meters = [
      { nodeKey: "a1", meter: "hours", date: "2024-04-01", value: 1000 },
      { nodeKey: "a1", meter: "hours", date: "2025-04-01", value: 1000 + 365 * 24 },
      { nodeKey: "a2", meter: "hours", date: "2025-04-01", value: 999999 },
    ];
    const withMeters = Plan.parse({ ...p, meters });
    const r = workDue(withMeters, withMeters.works[0]!, "2025-04-01");
    // 起点 2024-04-01 の 1,000 時間から 8,000 時間 → 1 日 24 時間で 334 日目
    expect(r).toMatchObject({ due: "2025-03-01", by: 0 });
    if (r.status !== "due") throw new Error(r.status);
    expect(r.notes).not.toContain("calendarOnly");
    expect(r.branches[0]).toMatchObject({ projected: true });
  });

  it("きっかけの無い作業は noTrigger、形の読めないきっかけは triggerInvalid（推測で埋めない）", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT")],
      works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "OVERHAUL", ["a1"], { trigger: { years: 3 } }), work("w3", "OVERHAUL", ["a1"], { trigger: { branches: [{ kind: "calendar", years: 3, extra: 1 }], combine: "earliest" } })],
      details: [],
    });
    const m = planDue(p, "2026-01-01");
    expect([...m.values()].map((x) => x.status)).toEqual(["noTrigger", "triggerInvalid", "triggerInvalid"]);
  });

  it("計量値の記録は計画の型が受ける（日付の形と数）", () => {
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [], details: [] });
    expect(Plan.safeParse({ ...p, meters: [{ nodeKey: "a1", meter: "hours", date: "2025/04/01", value: 1 }] }).success).toBe(false);
    expect(Plan.safeParse({ ...p, meters: [{ nodeKey: "a1", meter: "hours", date: "2025-04-01", value: 1 }] }).success).toBe(true);
  });
});
