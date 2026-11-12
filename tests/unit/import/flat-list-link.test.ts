// 資料をまたいで機器を結ぶ（書類の一般の形。業種の語に依らない架空の資料）：
// 号を名前に添えた平たい一覧（「送風機（1号炉）」）と、設備の下に機器と号の行を書いた星取表。親の段の書き方が資料で違っても、
// 名前も号の数も同じ機器がただ 1 つなら、結ぶ候補にする（同じ段だけで比べると、結べずに別の機器が 2 つになる）
import { describe, expect, test } from "vitest";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

describe("号を名前に添えた平たい一覧と、星取表の号の行", () => {
  test("星取表の 1 号の行は、一覧の「（1号炉）」の行と同じ機器として結ぶ案になる", async () => {
    const list = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["設備・機器", "対象箇所", "診断項目"],
        ["送風機（1号炉）", "軸受", "振動"],
        ["送風機（2号炉）", "軸受", "振動"],
      ]);
    }, "管理基準");
    const chart = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["設備・機器名称", null, null, null, "機器番号", "点検・整備内容", "周期", "2022年度", "2023年度"],
        ["5．通風設備", null, null, null, null, null, null, null, null],
        [null, "送風機", null, null, null, null, null, null, null],
        [null, null, "#1", null, "F-101", "分解整備", 2, "◎", null],
        [null, null, "#2", null, "F-201", "分解整備", 2, null, "◎"],
      ]);
      ws.mergeCells("A1:D1");
    }, "計画");
    const s = session();
    await s.add([
      { name: "管理基準.xlsx", bytes: list },
      { name: "計画.xlsx", bytes: chart },
    ]);
    for (let i = 0; i < 6; i++) {
      const open = s.analyze().open.filter((q) => !q.decision && q.kind !== "assetLink" && q.kind !== "assetLinkOne");
      if (!open.length) break;
      s.settle(open.map((q) => human(q.questionId, q.kind === "noLegend" || q.kind === "unknownSymbol" ? "actual" : (q.defaultAnswer ?? q.options[0]?.id ?? ""))));
    }
    const link = s.analyze().open.find((q) => q.kind === "assetLink" && q.items.some((it) => it.target?.some((t) => t.file === "管理基準.xlsx")));
    expect(link, s.analyze().open.map((q) => `${q.kind}:${q.text}`).join("\n")).toBeDefined();
    expect(link?.defaultAnswer).toBe("yes");
    acceptDefaults(s);
    const plan = s.compose().plan;
    const one = plan?.assets.find((a) => a.sources.some((x) => x.file === "計画.xlsx" && x.cell === "C4"));
    expect(one?.sources.some((x) => x.file === "管理基準.xlsx" && x.cell === "A2")).toBe(true);
    const two = plan?.assets.find((a) => a.sources.some((x) => x.file === "計画.xlsx" && x.cell === "C5"));
    expect(two?.sources.some((x) => x.file === "管理基準.xlsx" && x.cell === "A3")).toBe(true);
  });
});
