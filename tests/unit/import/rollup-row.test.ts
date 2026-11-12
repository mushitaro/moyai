// まとめの行（docs/plan.md §2.6：直してよいのは一般の手がかりと一般の質問の形だけ）。どの業種の語にも依らない架空の小さな星取表。
// - 下の段の機器の行を持つ親の行で、作業の欄も費用も無く、印のある年のどれにも下の行の印がある：下の行の印を年ごとにまとめて写した行。
//   親の行の印を作業にせず外すのを推す 1 問（決めるのは人）。外した印は理由ごとに数える
// - 親の行に、下の行に無い年の印があれば、まとめの行とは見ない（問いにしない）
import { describe, expect, test } from "vitest";
import type { IntakeSession } from "../../../src/import";
import { rows, session, xlsxOf } from "./helpers";

const chart = (parent: (string | null)[]) =>
  xlsxOf((ws) => {
    rows(ws, 1, [
      ["設備", "機器", "点検内容", "2022", "2023", "2024"],
      ["クレーン", null, null, ...parent],
      [null, "巻上装置", "点検", "○", null, null],
      [null, "走行装置", "点検", null, "○", null],
      ["ポンプ", null, "整備", "○", null, null],
    ]);
  }, "計画");

/** 推した答えで答える（凡例の無い記号は計画）。rollup に答えを渡せばまとめの行の問いにその答え、null なら答えずに残す */
function settleDefaults(s: IntakeSession, rollup: string | null) {
  for (let i = 0; i < 10; i++) {
    const rest = s.analyze().open.filter((x) => !x.decision && (rollup !== null || !x.text.includes("まとめて写した")));
    if (!rest.length) break;
    s.settle(
      rest.map((x) => ({
        questionId: x.questionId,
        answer: x.kind === "noLegend" ? "plan" : x.text.includes("まとめて写した") && rollup ? rollup : (x.defaultAnswer ?? x.options[0]?.id ?? ""),
        author: "human" as const,
        reason: "試験の台本が押した",
      })),
    );
  }
}

const targetsOf = (s: IntakeSession, name: string) => {
  const plan = s.compose().plan;
  const node = plan?.assets.find((a) => a.name === name);
  return plan?.works.filter((w) => w.targets.includes(node?.nodeKey ?? "?")).length ?? -1;
};

describe("まとめの行", () => {
  test("下の行の印を年ごとに写した親の行は、外すのを推す 1 問。推した答えで、親の機器の作業はできず、外した印のセルは理由ごとに数える", async () => {
    const s = session();
    await s.add([{ name: "計画.xlsx", bytes: await chart(["○", "○", null]) }]);
    settleDefaults(s, null);
    const open = s.analyze().open;
    expect(open).toHaveLength(1);
    const q = open[0];
    expect(q?.text).toContain("まとめて写した");
    expect(q?.defaultAnswer).toBe("exclude");
    expect(q?.options.map((o) => o.id)).toEqual(["exclude", "keep"]);
    expect(q?.items).toHaveLength(1);
    settleDefaults(s, "exclude");
    expect(s.analyze().open).toEqual([]);
    expect(targetsOf(s, "クレーン")).toBe(0);
    expect(targetsOf(s, "巻上装置")).toBeGreaterThan(0);
    const fc = s.compose().counts.find((x) => x.file === "計画.xlsx");
    expect(fc?.excludedCells["まとめの行の印（下の行の印を年ごとにまとめた行。決定で外した）"]).toBe(2);
  });

  test("「その機器の作業の印として読む」と答えれば、親の機器の作業として読む", async () => {
    const s = session();
    await s.add([{ name: "計画.xlsx", bytes: await chart(["○", "○", null]) }]);
    settleDefaults(s, "keep");
    expect(s.analyze().open).toEqual([]);
    expect(targetsOf(s, "クレーン")).toBeGreaterThan(0);
  });

  test("親の行に、下の行に無い年の印があれば、まとめの行とは見ない（問いにしない）", async () => {
    const s = session();
    await s.add([{ name: "計画.xlsx", bytes: await chart(["○", "○", "○"]) }]);
    settleDefaults(s, null);
    expect(s.analyze().open).toEqual([]);
    expect(targetsOf(s, "クレーン")).toBeGreaterThan(0);
  });
});
