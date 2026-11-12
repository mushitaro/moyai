// 星取表の「名前の欄が空の作業の行」の読み方（書類の一般の形。業種の語に依らない架空の資料）：
// - 設備・号・部位の列を左からずらして書く表で、名前も号も空の作業の行は、上の行の機器（号のある機器）の別の作業
// - 部位の行のあとに、上の段（設備）の名前か号だけを書いた行は、新しい機器の行（上の部位の続きではない）
import { describe, expect, test } from "vitest";
import { acceptDefaults, rows, session, xlsxOf } from "./helpers";

async function chart() {
  return xlsxOf((ws) => {
    rows(ws, 1, [
      ["設備・機器名称", null, null, null, "機器番号", "点検・整備内容", "周期", "2022年度", "2023年度"],
      ["1．搬入設備", null, null, null, null, null, null, null, null],
      [null, "搬送機", null, null, null, null, null, null, null],
      [null, null, "No.1", null, "T-1", "年次点検", 1, "○", "○"],
      [null, null, null, null, null, "性能検査", 2, "○", null],
      [null, null, null, "軸受", null, "交換", 2, null, "○"],
      [null, null, "No.2", null, "T-2", "年次点検", 1, "○", "○"],
      [null, null, null, "軸受", null, "交換", 2, "○", null],
      [null, "送風機", null, null, "F-1", "点検", 1, "○", "○"],
    ]);
    ws.mergeCells("A1:D1");
  }, "計画");
}

describe("名前の欄が空の作業の行", () => {
  test("名前も号も空の行は上の号の機器の作業。上の段の名前か号のある行は新しい機器", async () => {
    const s = session();
    await s.add([{ name: "計画.xlsx", bytes: await chart() }]);
    for (let i = 0; i < 6; i++) {
      const open = s.analyze().open.filter((q) => !q.decision);
      if (!open.length) break;
      s.settle(open.map((q) => ({ questionId: q.questionId, answer: q.kind === "noLegend" ? "plan" : (q.defaultAnswer ?? q.options[0]?.id ?? ""), author: "human" as const, reason: "試験の台本が押した" })));
    }
    acceptDefaults(s);
    const plan = s.compose().plan;
    expect(plan).not.toBeNull();
    const nodeOf = (cell: string) => plan?.details.find((d) => d.sources.some((x) => x.cell === cell))?.workKey;
    const targetsOf = (cell: string) => plan?.works.find((w) => w.workKey === nodeOf(cell))?.targets ?? [];
    // 4 行目（No.1 の年次点検）と 5 行目（名前も号も空の性能検査）は同じ機器
    expect(targetsOf("H5")).toEqual(targetsOf("H4"));
    // 7 行目（No.2）は 4 行目と別の機器
    expect(targetsOf("H7")).not.toEqual(targetsOf("H4"));
    // 9 行目（送風機）は、すぐ上の部位（軸受）の続きではない
    expect(targetsOf("H9")).not.toEqual(targetsOf("H8"));
    const names = plan?.assets.map((a) => a.name) ?? [];
    expect(names).toContain("送風機");
  });
});
