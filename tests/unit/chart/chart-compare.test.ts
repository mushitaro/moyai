// 版どうしの差（src/plan/chart-compare.ts）：同じ作り方の 2 つの星取表を、行の鍵 × 期の鍵で比べる。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildChart, catalogFromPack, type ChartLabels, type ChartModel, type ChartOptions } from "../../../src/plan/chart";
import { changedFrom, compareCounts, compareKey, marksOf, oldMark } from "../../../src/plan/chart-compare";
import { Plan } from "../../../src/shared/plan";
import { truthToPlan } from "../../fixtures/chart/truth-to-plan.mjs";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), json("packs/_kinds/work.json"));
const labels: ChartLabels = { levelFallback: (n) => `L${n}`, commonLevels: ["S", "I", "A"], unmapped: "UNMAPPED", series: (s) => `S${s}` };
const opts: ChartOptions = { mode: "ledger", period: "year", layer: "original", foldLevel: null };

describe("版どうしの差", () => {
  const before = Plan.parse(truthToPlan("fictional-1"));
  const prevModel = buildChart(before, catalog, labels, opts);
  const prev = marksOf(prevModel);

  it("同じ計画どうしなら、変わったセルも、比べる版にだけある印も 0", () => {
    expect(prev.size).toBeGreaterThan(0);
    expect(compareCounts(prev, buildChart(before, catalog, labels, opts))).toEqual({ changed: 0, old: 0 });
  });

  it("足した・変えたセルは変わった、消したセルは比べる版の印になる。似た施設と統計の行は比べない", () => {
    const cell = (mark: "plan" | "actual" | "both" | null) => ({ mark, summary: false, count: null, review: false, change: null, detailKeys: [] });
    const model = (rows: { id: string; kind: string; cells: Record<string, ReturnType<typeof cell>> }[]) => ({ rows }) as unknown as ChartModel;
    const was = marksOf(
      model([
        { id: "n1", kind: "node", cells: { "2024": cell("plan"), "2025": cell("plan"), "2026": cell("actual") } },
        { id: "p1", kind: "peer", cells: { "2024": cell("actual") } },
      ]),
    );
    expect([...was.keys()].sort()).toEqual([compareKey("n1", "2024"), compareKey("n1", "2025"), compareKey("n1", "2026")].sort());
    const now = model([
      // 2024 は同じ、2025 は消した、2026 は計画と実施に変えた、2027 は足した
      { id: "n1", kind: "node", cells: { "2024": cell("plan"), "2026": cell("both"), "2027": cell("plan") } },
      { id: "p1", kind: "peer", cells: { "2025": cell("plan") } },
    ]);
    expect(compareCounts(was, now)).toEqual({ changed: 2, old: 1 });
    expect(changedFrom(was, "n1", "2024", "plan")).toBe(false);
    expect(changedFrom(was, "n1", "2026", "both")).toBe(true);
    expect(changedFrom(was, "n1", "2027", "plan")).toBe(true);
    expect(changedFrom(was, "n1", "2025", null)).toBe(false);
    expect(oldMark(was, "n1", "2025", null)).toBe("plan");
    expect(oldMark(was, "n1", "2024", "plan")).toBeNull();
    expect(oldMark(was, "n1", "2028", null)).toBeNull();
  });
});
