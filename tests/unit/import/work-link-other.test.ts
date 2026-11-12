// 作業の記録と星取の結び（書類の一般の形。業種の語に依らない架空の資料）：
// 同じ機器・同じ年度の星取（作業の名前つき）が 1 つで、名前の合う作業がその星取を持つとき、名前の違うほかの作業は、
// 作業ごとに聞かず、様式ごとに 1 問「日報・報告書だけの記録として入れるか」にする（推す答え：入れる）
import { describe, expect, test } from "vitest";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);

describe("星取の作業と名前の違う作業", () => {
  test("名前の合う作業が星取を持てば、名前の違う作業は 1 問にまとめ、日報だけの記録として入れる", async () => {
    const chart = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["機器名称", "点検・整備内容", "2022年度"],
        ["ポンプ", "年次点検", "●"],
      ]);
    }, "計画");
    const daily = csv(["日付,機器,作業内容,工数", "2022/5/10,ポンプ,年次点検,延べ4人", "2022/6/1,ポンプ,給油,延べ1人", "2022/7/1,ポンプ,清掃,延べ1人"]);
    const s = session();
    await s.add([
      { name: "計画.xlsx", bytes: chart },
      { name: "日報.csv", bytes: daily },
    ]);
    for (let i = 0; i < 6; i++) {
      const open = s.analyze().open.filter((q) => !q.decision && q.kind !== "workLink" && q.kind !== "workLinkOne");
      if (!open.length) break;
      s.settle(open.map((q) => human(q.questionId, q.kind === "noLegend" || q.kind === "unknownSymbol" ? "actual" : (q.defaultAnswer ?? q.options[0]?.id ?? ""))));
    }
    const open = s.analyze().open;
    expect(open.some((q) => q.kind === "workLinkOne")).toBe(false);
    const q = open.find((x) => x.kind === "workLink" && x.text.includes("作業の名前の合う別の作業"));
    expect(q?.defaultAnswer).toBe("yes");
    expect(q?.sameShapeRows).toBe(2);
    acceptDefaults(s);
    const plan = s.compose().plan;
    const mark = plan?.details.find((d) => d.sources.some((x) => x.file === "計画.xlsx" && x.cell === "C2"));
    const work = plan?.works.find((w) => w.workKey === mark?.workKey);
    expect(work?.kind).toBe("年次点検");
    expect(plan?.works.filter((w) => w.kind === "給油" || w.kind === "清掃").length).toBe(2);
  });
});
