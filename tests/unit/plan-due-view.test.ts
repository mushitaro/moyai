// 次回の見せ方（台帳の重-8b、docs/screens.md 3.2・3.5）：列の字は起点の粒度で、決まらないときは「―」と理由。
// 星取表の行の作業（chart.ts の works）と、1 つの行に作業がいくつもあるときの選び方。Excel の 4 列も同じ字
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildChart, catalogFromPack } from "../../src/plan/chart";
import { dueBaseDate, dueView, planDueViews, rowDue, rowDues } from "../../src/plan/due-view";
import { EXPORT_TEXT, planWorkbook } from "../../src/plan/export";
import { workDue } from "../../src/plan/next";
import { asset, detail, plan, work } from "./share/fixtures";

const calendar3 = { branches: [{ kind: "calendar", years: 3 }], combine: "earliest" };
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const workKinds = json("packs/_kinds/work.json");
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), workKinds);
const empty = catalogFromPack({ systems: [] }, workKinds);
const labels = { levelFallback: (n: number) => `第 ${n} 階層`, commonLevels: ["a", "b", "c"] as [string, string, string], unmapped: "未", series: (s: string) => s };

describe("次回の字", () => {
  it("日付の実績が起点なら日付。年度だけの実績・使用開始なら次回の年度。起点に粒度を添える", () => {
    const byDate = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [detail("d1", "w1", 2024, { startDate: "2024-07-10" })] });
    expect(dueView(workDue(byDate, byDate.works[0]!, "2026-01-01"), 4)).toMatchObject({ decided: true, text: "2027-07-10", basis: "暦", origin: "2024-07-10", latest: null, window: null, notes: "" });
    const byYear = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [detail("d1", "w1", 2022)] });
    expect(dueView(workDue(byYear, byYear.works[0]!, "2026-01-01"), 4)).toMatchObject({ text: "2025 年度", origin: "2022 年度（年度単位）" });
    const byStart = plan({ assets: [asset("a1", "T.FEED.LIFT", { installedOn: "2019-06-01" })], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [] });
    expect(dueView(workDue(byStart, byStart.works[0]!, "2026-01-01"), 4)).toMatchObject({ text: "2022 年度", origin: "2019-06-01（使用開始）" });
  });

  it("決まらないときは「―」と理由（朱にしない・推測で埋めない）", () => {
    const none = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"])], details: [] });
    expect(dueView(workDue(none, none.works[0]!, "2026-01-01"), 4)).toMatchObject({ decided: false, text: "―", notes: "周期なし" });
    const bad = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger: { every: "3Y" } })], details: [] });
    expect(dueView(workDue(bad, bad.works[0]!, "2026-01-01"), 4)).toMatchObject({ text: "―", notes: "周期不正" });
    const noOrigin = plan({ assets: [asset("a1", "T.FEED.LIFT", { installedOn: null })], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [] });
    expect(dueView(workDue(noOrigin, noOrigin.works[0]!, "2026-01-01"), 4)).toMatchObject({ text: "―", notes: "起点なし" });
    const meterOnly = plan({
      assets: [asset("a1", "T.FEED.LIFT")],
      works: [work("w1", "OVERHAUL", ["a1"], { trigger: { branches: [{ kind: "meter", meter: "運転時間", every: 8000 }], combine: "earliest" } })],
      details: [detail("d1", "w1", 2024, { startDate: "2024-04-01" })],
    });
    expect(dueView(workDue(meterOnly, meterOnly.works[0]!, "2026-01-01"), 4)).toMatchObject({ text: "―", notes: "稼働記録なし" });
  });

  it("運転時間の見込みが先なら、根拠は「運転時間（見込み）」。計量値が無く暦だけなら備考「暦のみ（使用量なし）」", () => {
    const trigger = { branches: [{ kind: "meter", meter: "運転時間", every: 8000 }, { kind: "calendar", years: 3 }], combine: "earliest" };
    const base = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger })], details: [detail("d1", "w1", 2024, { startDate: "2024-04-01" })] });
    expect(dueView(workDue(base, base.works[0]!, "2025-04-01"), 4)).toMatchObject({ text: "2027-04-01", basis: "暦", notes: "暦のみ（稼働記録なし）" });
    const meters = [
      { nodeKey: "a1", meter: "運転時間", date: "2024-04-01", value: 1000 },
      { nodeKey: "a1", meter: "運転時間", date: "2025-04-01", value: 1000 + 365 * 24 },
    ];
    const withMeters = { ...base, meters };
    const v = dueView(workDue(withMeters, withMeters.works[0]!, "2025-04-01"), 4);
    expect(v).toMatchObject({ decided: true, basis: "運転時間（見込み）" });
    expect(v.dueDate! < "2027-04-01").toBe(true);
  });

  it("行の作業：台帳の段の行は対象にその機器を持つ作業。親の段・作業の無い行は持たない。いくつもあれば早い次回", () => {
    const p = plan({
      assets: [asset("p", "T.FEED", { level: 1 }), asset("a1", "T.FEED.LIFT", { level: 2, parentKey: "p" })],
      works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 }), work("w2", "INSPECT", ["a1"], { trigger: { branches: [{ kind: "calendar", years: 1 }], combine: "earliest" } }), work("w3", "INSPECT", ["a1"])],
      details: [detail("d1", "w1", 2024, { startDate: "2024-07-10" }), detail("d2", "w2", 2024, { startDate: "2024-07-10" })],
    });
    const m = buildChart(p, empty, labels, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
    const row = m.rows.find((r) => r.id === "n:a1")!;
    expect(row.works).toEqual(["w1", "w2", "w3"]);
    expect(m.rows.find((r) => r.id === "n:p")!.works).toBeUndefined();
    const views = planDueViews(p, "2026-01-01");
    expect(rowDue(row.works, views)).toMatchObject({ workKey: "w2", text: "2025-07-10" });
    expect(rowDue(["w3"], views)).toMatchObject({ text: "―" });
    expect(rowDue(undefined, views)).toBeNull();
  });
});

describe("Excel の 4 列（次回｜期限｜根拠｜備考）", () => {
  it("作業の行の右端に、画面と同じ字。作業の無い行は空ける", async () => {
    const p = plan({
      assets: [asset("p", "T.FEED", { level: 1 }), asset("a1", "T.FEED.LIFT", { level: 2, parentKey: "p" })],
      works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })],
      details: [detail("d1", "w1", 2024, { startDate: "2024-07-10" })],
    });
    const buf = await planWorkbook({ plan: p, version: 1, at: "2026-01-01T00:00:00.000Z", catalog, emptyCatalog: empty });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(EXPORT_TEXT.sheetLedger)!;
    const head = (ws.getRow(6).values as unknown[]).slice(1).map(String);
    const at = head.indexOf("次回");
    expect(head.slice(at)).toEqual(["次回", "期限", "根拠", "備考"]);
    const rows: string[][] = [];
    ws.eachRow((r, n) => {
      if (n > 6) rows.push(Array.from((r.values as unknown[]).slice(1), (x) => (x === undefined || x === null ? "" : String(x))));
    });
    const child = rows.find((r) => r.includes("2027-07-10"));
    expect(child?.slice(at, at + 3)).toEqual(["2027-07-10", "", "暦"]);
    // 親の段の行（1 行目）には次回を書かない
    expect(rows[0]!.slice(at).every((x) => x === "")).toBe(true);
  });
});

describe("基準日と、行に残る決まらない作業（台帳の重-8b-a・b）", () => {
  it("基準日は日本時間の日付：4 月 1 日 0:30（日本）に確定した版では、その年度の実施が起点になる", async () => {
    expect(dueBaseDate("2026-03-31T15:30:00.000Z")).toBe("2026-04-01");
    expect(dueBaseDate("2026-04-01T00:30:00+09:00")).toBe("2026-04-01");
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 })], details: [detail("d1", "w1", 2023), detail("d2", "w1", 2026)] });
    const buf = await planWorkbook({ plan: p, version: 1, at: "2026-04-01T00:30:00+09:00", catalog, emptyCatalog: empty });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(EXPORT_TEXT.sheetLedger)!;
    const all: string[] = [];
    ws.eachRow((r) => all.push(...Array.from(r.values as unknown[], (x) => String(x ?? ""))));
    expect(all).toContain("2029 年度");
    expect(all).not.toContain("2026 年度（年度単位）");
  });

  it("早い次回を出すとき、同じ行に決まらない作業があれば備考に件数。横の板の並びは早い順で、決まらない作業は最後", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT")],
      works: [work("w0", "INSPECT", ["a1"]), work("w1", "OVERHAUL", ["a1"], { trigger: calendar3 }), work("w2", "INSPECT", ["a1"], { trigger: { branches: [{ kind: "calendar", years: 1 }], combine: "earliest" } })],
      details: [detail("d1", "w1", 2024, { startDate: "2024-07-10" }), detail("d2", "w2", 2024, { startDate: "2024-07-10" })],
    });
    const views = planDueViews(p, "2026-01-01");
    expect(rowDue(["w0", "w1", "w2"], views)).toMatchObject({ workKey: "w2", text: "2025-07-10", notes: "未確定 1" });
    expect(rowDues(["w0", "w1", "w2"], views).map((v) => v.workKey)).toEqual(["w2", "w1", "w0"]);
    expect(rowDue(["w1", "w2"], views)?.notes).toBe("");
  });
});
