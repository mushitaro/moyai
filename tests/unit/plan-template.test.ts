// 様式に写す（src/plan/template.ts）：見出しの言葉から列の役目を決め、確定した版の作業を 1 行ずつ写す。
import { describe, expect, it } from "vitest";
import { COLUMNS_SCHEMA, cellValue, findHeaderRow, fiscalYearOfHeader, isTemplateColumns, roleOfHeader, templateRows } from "../../src/plan/template";
import { asset, detail, plan, work } from "./share/fixtures";

describe("様式に写す", () => {
  it("見出しの年度：令和・平成・西暦・FY、全角も", () => {
    expect(fiscalYearOfHeader("R8")).toBe(2026);
    expect(fiscalYearOfHeader("令和９年度")).toBe(2027);
    expect(fiscalYearOfHeader("H30")).toBe(2018);
    expect(fiscalYearOfHeader("2026 年度")).toBe(2026);
    expect(fiscalYearOfHeader("FY2025")).toBe(2025);
    expect(fiscalYearOfHeader("備考")).toBeNull();
  });

  it("見出しの言葉から列の役目。決まらない列は未定", () => {
    expect(["設備名", "作業区分", "周期（年）", "R8", "備考", ""].map((h) => roleOfHeader(h))).toEqual([
      { kind: "item" },
      { kind: "work" },
      { kind: "cycle" },
      { kind: "year", fiscalYear: 2026 },
      { kind: "none" },
      { kind: "none" },
    ]);
  });

  it("見出しの行は、2 つ以上の欄に字がある最初の行", () => {
    expect(findHeaderRow([["長寿命化計画 様式 3"], [], ["設備名", "作業区分", "R8"]])).toBe(2);
    expect(findHeaderRow([["だけ"]])).toBe(0);
  });

  it("作業を 1 行ずつ：機器の名前・作業の言い方・周期（印の年度の差でいちばん多いもの）・年度の印", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT", { name: "焼却炉" }), asset("a2", "T.POWER.GEN", { name: "誘引通風機" })],
      works: [work("w1", "INSPECT", ["a1"]), work("w2", "OVERHAUL", ["a2"])],
      details: [
        detail("d1", "w1", 2023),
        detail("d2", "w1", 2024),
        detail("d3", "w1", 2025),
        detail("d4", "w1", 2026, { planOrActual: "plan" }),
        detail("d5", "w2", 2024),
      ],
    });
    const rows = templateRows(p, (a) => ({ INSPECT: "点検", OVERHAUL: "分解整備" })[a], "2026-11-06");
    expect(rows.map((r) => [r.item, r.work, r.cycle])).toEqual([
      ["焼却炉", "点検", 1],
      ["誘引通風機", "分解整備", null],
    ]);
    const r = rows[0]!;
    expect(cellValue({ kind: "year", fiscalYear: 2026 }, r)).toBe("○");
    expect(cellValue({ kind: "year", fiscalYear: 2025 }, r)).toBe("●");
    expect(cellValue({ kind: "year", fiscalYear: 2030 }, r)).toBe("");
    expect(cellValue({ kind: "cycle" }, rows[1]!)).toBe("");
    expect(cellValue({ kind: "none" }, r)).toBe("");
  });

  it("同じ機器の同じ作業（作業の言い方が同じ）は 1 行にまとめ、印を合わせる", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT", { name: "焼却炉" })],
      works: [work("w1", "INSPECT", ["a1"]), work("w2", "INSPECT", ["a1"])],
      details: [detail("d1", "w1", 2023), detail("d2", "w2", 2024), detail("d3", "w2", 2025, { planOrActual: "plan" })],
    });
    const rows = templateRows(p, () => "点検", "2026-11-06");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cycle).toBe(1);
    expect([2023, 2024, 2025].map((y) => cellValue({ kind: "year", fiscalYear: y }, rows[0]!))).toEqual(["●", "●", "○"]);
  });

  it("周期は取り込んだ周期（作業のきっかけ）から：資料に 5 年とあれば印が 1 つでも 5、6 か月は「6か月」、行の作業で違えば空（台帳の新-11）", () => {
    const cal = (c: { years?: number; months?: number }) => ({ branches: [{ kind: "calendar", ...c }], combine: "earliest" });
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT", { name: "焼却炉" }), asset("a2", "T.POWER.GEN", { name: "誘引通風機" }), asset("a3", "T.POWER.GEN", { name: "送風機" })],
      works: [
        work("w1", "OVERHAUL", ["a1"], { trigger: cal({ years: 5 }) }),
        work("w2", "INSPECT", ["a2"], { trigger: cal({ months: 6 }) }),
        work("w3", "INSPECT", ["a3"], { trigger: cal({ years: 1 }) }),
        work("w4", "INSPECT", ["a3"], { trigger: cal({ years: 2 }) }),
      ],
      details: [detail("d1", "w1", 2024), detail("d2", "w2", 2023), detail("d3", "w2", 2024), detail("d4", "w3", 2024), detail("d5", "w4", 2025)],
    });
    const rows = templateRows(p, (a) => ({ INSPECT: "点検", OVERHAUL: "分解整備" })[a], "2026-11-06");
    expect(rows.map((r) => [r.item, r.cycle])).toEqual([
      ["焼却炉", 5],
      ["送風機", null],
      ["誘引通風機", "6か月"],
    ]);
  });

  it("「← 次回」を当てた列にだけ、画面と同じ次回の字（見出しの言葉からは決めない）", () => {
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT", { name: "焼却炉" }), asset("a2", "T.POWER.GEN", { name: "誘引通風機" })],
      works: [work("w1", "OVERHAUL", ["a1"], { trigger: { branches: [{ kind: "calendar", years: 3 }], combine: "earliest" } }), work("w2", "INSPECT", ["a2"])],
      details: [detail("d1", "w1", 2024, { startDate: "2024-07-10" }), detail("d2", "w2", 2024)],
    });
    const rows = templateRows(p, (a) => ({ INSPECT: "点検", OVERHAUL: "分解整備" })[a], "2026-11-06");
    expect(cellValue({ kind: "next" }, rows[0]!)).toBe("2027-07-10");
    expect(cellValue({ kind: "next" }, rows[1]!)).toBe("―");
    expect(roleOfHeader("次回")).toEqual({ kind: "none" });
    expect(isTemplateColumns({ schema: COLUMNS_SCHEMA, headerRow: 1, headers: ["次回"], roles: [{ kind: "next" }] })).toBe(true);
  });
});
