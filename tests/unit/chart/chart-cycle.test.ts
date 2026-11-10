// 時間の地図 1（mushitaro/moyai#31）：周期の線は、選んだ行の星どうしを結ぶ。未来の ○ へは破線。間隔は始まりの星に。良否は判定しない
import { describe, expect, it } from "vitest";
import { cycleOf } from "../../../src/app/chart/grid";
import type { ChartRow } from "../../../src/plan/chart";

const keys = ["y2021", "y2022", "y2023", "y2024", "y2025", "y2026"];
const row = (marks: Record<string, "plan" | "actual" | "both">): ChartRow =>
  ({ id: "r", cells: Object.fromEntries(Object.entries(marks).map(([k, mark]) => [k, { mark, detailKeys: [] }])) }) as unknown as ChartRow;

describe("周期の線", () => {
  const r = row({ y2021: "actual", y2024: "actual", y2026: "plan" });
  it("星の右に次の星までの間隔（年）、左は前の星から", () => {
    expect(cycleOf(r, keys, "y2021")).toEqual({ left: null, right: "solid", gap: 3 });
    expect(cycleOf(r, keys, "y2024")).toEqual({ left: "solid", right: "dash", gap: 2 });
    expect(cycleOf(r, keys, "y2026")).toEqual({ left: "dash", right: null, gap: null });
  });
  it("星と星の間の空のセルは、両の半分に線。未来の ○ へ向かう間は破線", () => {
    expect(cycleOf(r, keys, "y2022")).toEqual({ left: "solid", right: "solid", gap: null });
    expect(cycleOf(r, keys, "y2025")).toEqual({ left: "dash", right: "dash", gap: null });
  });
  it("星の外側と、表に無い期には何も引かない", () => {
    const r2 = row({ y2022: "actual", y2024: "both" });
    expect(cycleOf(r2, keys, "y2021")).toEqual({ left: null, right: null, gap: null });
    expect(cycleOf(r2, keys, "y2026")).toEqual({ left: null, right: null, gap: null });
    expect(cycleOf(r2, keys, "m2024-04")).toEqual({ left: null, right: null, gap: null });
    // ◎（計画と実績）は破線にしない
    expect(cycleOf(r2, keys, "y2022").right).toBe("solid");
  });
});
