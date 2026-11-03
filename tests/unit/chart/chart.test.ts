// 星取表の行と印（src/plan/chart.ts）：段・空け・畳む・台数・印・共通の行・未当てはめ・年度の始まりの月。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildChart,
  buildPeriods,
  catalogFromPack,
  fiscalYearOf,
  monthsOfFiscalYear,
  nextFoldLevel,
  periodKeyOf,
  type ChartLabels,
  type ChartOptions,
} from "../../../src/plan/chart";
import { Plan, type AssetNodeT, type WorkDetailT, type WorkT } from "../../../src/shared/plan";
import { truthToPlan } from "../../fixtures/chart/truth-to-plan.mjs";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), json("packs/_kinds/work.json"));
const labels: ChartLabels = { levelFallback: (n) => `L${n}`, commonLevels: ["S", "I", "A"], unmapped: "UNMAPPED" };
const base: ChartOptions = { mode: "ledger", period: "year", layer: "original", foldLevel: null };

function asset(nodeKey: string, level: number, parentKey: string | null, name: string, extra: Partial<AssetNodeT> = {}): AssetNodeT {
  return {
    nodeKey,
    tag: null,
    name,
    level,
    parentKey,
    classCode: null,
    commonItem: null,
    commonItemAuthor: null,
    commonItemBasis: null,
    commonItemAccepted: false,
    specs: [],
    installedOn: null,
    removedOn: null,
    replacedOn: null,
    series: null,
    sources: [],
    ...extra,
  };
}
function work(workKey: string, targets: string[], attribute: WorkT["attribute"] = "INSPECT"): WorkT {
  return { workKey, kind: "k", attribute, strategy: null, targets, trigger: null, checkIds: [], contractor: null, parentWorkKey: null, tagRange: null, tagList: [] };
}
function detail(detailKey: string, workKey: string, fiscalYear: number, planOrActual: "plan" | "actual", startDate: string | null = null, needsReview = false): WorkDetailT {
  return {
    detailKey,
    workKey,
    planOrActual,
    step: null,
    startDate,
    endDate: null,
    fiscalYear,
    cost: null,
    manDays: null,
    days: null,
    resultScale: null,
    resultValue: null,
    measuredValue: null,
    previousValue: null,
    performer: null,
    sources: [{ file: "f.xlsx", sheet: "s", page: null, cell: "C3", box: null }],
    basis: "b",
    author: "ai_reading",
    needsReview,
  };
}

/** 2 つの設備、機器 3 台、部位 1 つ。WI.DRAFT.FDF・IDF は受けた当てはめ、E3 は案のまま */
function small(): Plan {
  return Plan.parse({
    schema: "moyai.plan/0",
    planId: "p",
    displayName: "p",
    packId: "waste-incineration",
    version: 0,
    levelNames: ["A", ""],
    facility: { facilityKey: "f", name: "f", fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
    assets: [
      asset("S1", 1, null, "sys1"),
      asset("E1", 2, "S1", "eq1", { commonItem: "WI.DRAFT.FDF", commonItemAccepted: true }),
      asset("P1", 3, "E1", "part1"),
      asset("E2", 2, "S1", "eq2", { commonItem: "WI.DRAFT.IDF", commonItemAccepted: true }),
      asset("S2", 1, null, "sys2"),
      asset("E3", 2, "S2", "eq3", { commonItem: "WI.DRAFT.IDF", commonItemAccepted: false }),
    ],
    works: [work("W1", ["E1"]), work("W2", ["E1"], "OVERHAUL"), work("W3", ["E2"]), work("W4", ["E3"]), work("W5", ["P1"]), work("W6", ["E2"], null)],
    details: [
      detail("D1", "W1", 2020, "plan", "2020-07-01"),
      detail("D2", "W1", 2020, "actual", "2020-07-10"),
      detail("D3", "W2", 2021, "actual", "2022-02-01"),
      detail("D4", "W3", 2020, "plan"),
      detail("D5", "W4", 2022, "actual", null, true),
      detail("D6", "W5", 2021, "plan"),
      detail("D7", "W6", 2023, "plan"),
    ],
  });
}

describe("年度と月", () => {
  it("始まりの月より前の月は前の年の年度", () => {
    expect(fiscalYearOf("2020-04-01", 4)).toBe(2020);
    expect(fiscalYearOf("2021-03-31", 4)).toBe(2020);
    expect(fiscalYearOf("2021-03-31", 1)).toBe(2021);
    expect(fiscalYearOf("2020-09-30", 10)).toBe(2019);
    expect(() => fiscalYearOf("2020/04/01", 4)).toThrow();
  });

  it("月の並びは始まりの月から 12 か月", () => {
    expect(monthsOfFiscalYear(4)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]);
    expect(monthsOfFiscalYear(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("年だけの表は記録の最初から最後の年度まで切れ目なく、月の表は年度の下に月", () => {
    const p = small();
    expect(buildPeriods(p, "year").map((x) => x.key)).toEqual(["fy2020", "fy2021", "fy2022", "fy2023"]);
    const m = buildPeriods(p, "month");
    // 2020・2021・2022・2023 年度に日付の無い記録があるので、その年度の前に年度だけの列
    expect(m.filter((x) => x.fiscalYear === 2020).map((x) => x.key)).toEqual([
      "fy2020",
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((mo) => `fy2020-m${String(mo).padStart(2, "0")}`),
    ]);
    // 2022-02 の記録は 2021 年度の 2 月の列（始まりの月が 4 月）
    expect(periodKeyOf({ fiscalYear: 2021, startDate: "2022-02-01" }, "month")).toBe("fy2021-m02");
    const keys = m.map((x) => x.key);
    expect(keys.indexOf("fy2021-m02")).toBeGreaterThan(keys.indexOf("fy2021-m12"));
    expect(keys.indexOf("fy2021-m02")).toBeLessThan(keys.indexOf("fy2022-m04"));
  });

  it("始まりの月を変えると月の並びが変わる", () => {
    const p = small();
    p.facility.fiscalYearStartMonth = 1;
    expect(buildPeriods(p, "month").filter((x) => x.fiscalYear === 2021 && x.month !== null)[0]?.month).toBe(1);
  });
});

describe("台帳の段の行", () => {
  it("平らな行に level と parentId、段の名前（名前の無い段は第 n 階層）", () => {
    const m = buildChart(small(), catalog, labels, base);
    expect(m.levelNames).toEqual(["A", "L2", "L3"]);
    expect(m.rows.map((r) => [r.id, r.level, r.parentId])).toEqual([
      ["n:S1", 1, null],
      ["n:E1", 2, "n:S1"],
      ["n:P1", 3, "n:E1"],
      ["n:E2", 2, "n:S1"],
      ["n:S2", 1, null],
      ["n:E3", 2, "n:S2"],
    ]);
    expect(m.totalRows).toBe(6);
    expect(m.orphanDetails).toEqual([]);
  });

  it("上の行と同じ名前は空ける。この行の段の列は空けない", () => {
    const m = buildChart(small(), catalog, labels, base);
    expect(m.rows.map((r) => r.levelCells)).toEqual([
      ["sys1", "", ""],
      ["", "eq1", ""],
      ["", "", "part1"],
      ["", "eq2", ""],
      ["sys2", "", ""],
      ["", "eq3", ""],
    ]);
    expect(m.rows[2]?.path).toEqual(["sys1", "eq1", "part1"]);
  });

  it("印：○ 計画、● 実施、◎ 同じ年度に両方。要確認の印も持つ", () => {
    const m = buildChart(small(), catalog, labels, base);
    const e1 = m.rows.find((r) => r.id === "n:E1");
    expect(e1?.cells.fy2020?.mark).toBe("both");
    expect(e1?.cells.fy2020?.detailKeys.sort()).toEqual(["D1", "D2"]);
    expect(e1?.cells.fy2021?.mark).toBe("actual");
    expect(m.rows.find((r) => r.id === "n:E2")?.cells.fy2020?.mark).toBe("plan");
    expect(m.rows.find((r) => r.id === "n:E3")?.cells.fy2022?.review).toBe(true);
    expect(m.rows.find((r) => r.id === "n:S1")?.cells).toEqual({});
  });

  it("月の表では、同じ年度でも月が違えば別の列", () => {
    const m = buildChart(small(), catalog, labels, { ...base, period: "month" });
    const e1 = m.rows.find((r) => r.id === "n:E1");
    expect(e1?.cells["fy2020-m07"]?.mark).toBe("both");
    expect(e1?.cells["fy2021-m02"]?.mark).toBe("actual");
    // 日付の無い記録は年度だけの列
    expect(m.rows.find((r) => r.id === "n:E2")?.cells.fy2020?.mark).toBe("plan");
  });

  it("段で畳む：深い行を隠し、まとめの印と台数（行は中の節の数、期は印のある機器の数）", () => {
    const m = buildChart(small(), catalog, labels, { ...base, foldLevel: 1 });
    expect(m.rows.map((r) => r.id)).toEqual(["n:S1", "n:S2"]);
    const s1 = m.rows[0];
    expect(s1?.folded).toBe(true);
    expect(s1?.count).toBe(3); // E1・P1・E2
    expect(s1?.cells.fy2020).toMatchObject({ mark: "both", summary: true, count: 2 }); // E1 と E2
    expect(s1?.cells.fy2021).toMatchObject({ mark: "both", summary: true, count: 2 }); // E1 の ● と P1 の ○
    expect(s1?.detailKeys.sort()).toEqual(["D1", "D2", "D3", "D4", "D6", "D7"]);
    expect(m.totalRows).toBe(6);
  });

  it("2 段目で畳むと、子のある機器だけが畳まれる", () => {
    const m = buildChart(small(), catalog, labels, { ...base, foldLevel: 2 });
    expect(m.rows.map((r) => [r.id, r.folded])).toEqual([
      ["n:S1", false],
      ["n:E1", true],
      ["n:E2", false],
      ["n:S2", false],
      ["n:E3", false],
    ]);
    expect(m.rows[1]?.count).toBe(1);
  });

  it("行ごとに畳む状態も外から渡せる", () => {
    const m = buildChart(small(), catalog, labels, { ...base, collapsed: new Set(["n:S2"]) });
    expect(m.rows.map((r) => r.id)).toEqual(["n:S1", "n:E1", "n:P1", "n:E2", "n:S2"]);
  });

  it("見出しをもう一度押すと開く", () => {
    expect(nextFoldLevel(null, 1)).toBe(1);
    expect(nextFoldLevel(1, 1)).toBeNull();
    expect(nextFoldLevel(1, 2)).toBe(2);
  });

  it("調整後：変更のある期は後の印と変更を持ち、元の計画では変わらない", () => {
    const change = { nodeKey: "E2", fiscalYear: 2020, month: null, before: "plan" as const, after: "both" as const, author: "human" as const, who: "x", reason: "r" };
    const adj = buildChart(small(), catalog, labels, { ...base, layer: "adjusted", changes: [change] });
    expect(adj.rows.find((r) => r.id === "n:E2")?.cells.fy2020).toMatchObject({ mark: "both", change });
    const orig = buildChart(small(), catalog, labels, { ...base, layer: "original", changes: [change] });
    expect(orig.rows.find((r) => r.id === "n:E2")?.cells.fy2020).toMatchObject({ mark: "plan", change: null });
    // 変更が無ければ調整後は元の計画と同じ
    expect(buildChart(small(), catalog, labels, { ...base, layer: "adjusted" }).rows).toEqual(buildChart(small(), catalog, labels, base).rows);
  });

  it("対象の機器が計画に無い記録は捨てずに数える", () => {
    const p = small();
    p.works.push(work("W9", ["NOPE"]));
    p.details.push(detail("D9", "W9", 2020, "plan"));
    expect(buildChart(p, catalog, labels, base).orphanDetails).toEqual(["D9"]);
  });
});

describe("共通の設備項目の行", () => {
  it("設備 › 項目 › 作業の属性。名前はパックから読む。人が受けていない当てはめと属性の無い記録は未当てはめの 1 行に", () => {
    const m = buildChart(small(), catalog, labels, { ...base, mode: "common" });
    expect(m.levelNames).toEqual(["S", "I", "A"]);
    const work = json("packs/_kinds/work.json").work;
    expect(m.rows.map((r) => [r.id, r.levelCells])).toEqual([
      ["c:WI.DRAFT", ["通風設備", "", ""]],
      ["c:WI.DRAFT.FDF", ["", "押込送風機", ""]],
      ["c:WI.DRAFT.FDF:INSPECT", ["", "", work.INSPECT.label]],
      ["c:WI.DRAFT.FDF:OVERHAUL", ["", "", work.OVERHAUL.label]],
      ["c:WI.DRAFT.IDF", ["", "誘引通風機", ""]],
      ["c:WI.DRAFT.IDF:INSPECT", ["", "", work.INSPECT.label]],
      ["c:unmapped", ["UNMAPPED", "", ""]],
    ]);
    const un = m.rows.at(-1);
    expect(un?.kind).toBe("unmapped");
    expect(un?.count).toBe(3); // D5（案のまま）・D6（部位に当てはめ無し）・D7（属性が無い）
    expect(un?.detailKeys.sort()).toEqual(["D5", "D6", "D7"]);
    expect(un?.cells.fy2022?.mark).toBe("actual");
  });

  it("共通の行を設備の段で畳むと、台数は当てた機器の数", () => {
    const m = buildChart(small(), catalog, labels, { ...base, mode: "common", foldLevel: 1 });
    expect(m.rows.map((r) => r.id)).toEqual(["c:WI.DRAFT", "c:unmapped"]);
    expect(m.rows[0]).toMatchObject({ folded: true, count: 2 });
    expect(m.rows[0]?.cells.fy2020).toMatchObject({ mark: "both", summary: true, count: 2 });
    expect(m.rows[1]?.folded).toBe(false);
  });

  it("全部に当てはめがあれば未当てはめの行は出さない", () => {
    const p = small();
    p.details = p.details.filter((d) => !["D5", "D6", "D7"].includes(d.detailKey));
    expect(buildChart(p, catalog, labels, { ...base, mode: "common" }).rows.some((r) => r.kind === "unmapped")).toBe(false);
  });

  it("パックの言い換えが work.json の既定より先", () => {
    const c = json("packs/waste-incineration/common.json");
    const alt = catalogFromPack({ ...c, work: { INSPECT: { label: "X" } } }, json("packs/_kinds/work.json"));
    expect(alt.workLabels.INSPECT).toBe("X");
    expect(alt.workLabels.OVERHAUL).toBe(catalog.workLabels.OVERHAUL);
    expect(() => catalogFromPack({}, {})).toThrow();
  });

  it("パックに無い項目の記録は捨てずに数える", () => {
    const p = small();
    (p.assets[3] as AssetNodeT).commonItem = "WI.NOPE.X";
    expect(buildChart(p, catalog, labels, { ...base, mode: "common" }).orphanDetails).toEqual(["D4"]);
  });
});

describe("工場の正解から組んだ計画（試験の道具）", () => {
  it("2 つの施設とも計画の書類の型に合い、全部の記録が行に載る", () => {
    for (const id of ["fictional-1", "fictional-2"] as const) {
      const p = Plan.parse(truthToPlan(id));
      expect(p.details.length).toBeGreaterThan(100);
      for (const mode of ["ledger", "common"] as const) {
        const m = buildChart(p, catalog, labels, { ...base, mode });
        expect(m.orphanDetails).toEqual([]);
        const seen = new Set(m.rows.flatMap((r) => r.detailKeys));
        expect(seen.size).toBe(p.details.length);
      }
    }
  });

  it("fictional-2 は 4 段。1 段目で畳むと設備の数の行", () => {
    const p = truthToPlan("fictional-2");
    const m = buildChart(p, catalog, labels, base);
    expect(m.levelNames).toEqual(p.levelNames);
    expect(m.levelNames.length).toBe(4);
    const folded = buildChart(p, catalog, labels, { ...base, foldLevel: 1 });
    expect(folded.rows.length).toBe(p.assets.filter((a) => a.level === 1).length);
    expect(folded.rows.every((r) => r.folded && r.count !== null && r.count > 0)).toBe(true);
  });

  it("共通の行の未当てはめは、人がまだ受けていない機器の記録の数", () => {
    const p = truthToPlan("fictional-1");
    const pending = new Set(p.assets.filter((a) => a.commonItem !== null && !a.commonItemAccepted).map((a) => a.nodeKey));
    const works = new Set(p.works.filter((w) => w.targets.some((t) => pending.has(t))).map((w) => w.workKey));
    const n = p.details.filter((d) => works.has(d.workKey)).length;
    const m = buildChart(p, catalog, labels, { ...base, mode: "common" });
    expect(n).toBeGreaterThan(0);
    expect(m.rows.find((r) => r.kind === "unmapped")?.count).toBe(n);
  });

  it("厚さの試し（×40）でも全部の記録が行に載る", () => {
    const p = truthToPlan("fictional-1", { scale: 40 });
    expect(p.assets.length).toBeGreaterThan(1000);
    const m = buildChart(p, catalog, labels, { ...base, period: "month" });
    expect(new Set(m.rows.flatMap((r) => r.detailKeys)).size).toBe(p.details.length);
  });
});
