// 書類の一般の形の試験（docs/plan.md §2.6：直してよいのは一般の手がかりと一般の質問の形だけ）。どの業種の語にも依らない架空の小さな資料。
// - 作業の名前の手がかりの列が 2 つ（「作業区分」と「作業内容」）：語そのものの見出しが作業の名前の列。頭の語で当たっただけの列は、終わりの語（区分）で読む
// - まとめた工事の行（作業の欄が一式だけ。内訳はほかの行）：名前の同じ機器が無ければ、作業にせず記録に残すのを推す 1 問（決めるのは人）
// - 同じ親の下に同じ名前の機器が 2 つあり、先の資料には 1 つだけ：1 つに結ばず、別の機器として入れるのを推す 1 問（決めるのは人）
import { describe, expect, test } from "vitest";
import { acceptDefaults, rows, session, xlsxOf } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);

describe("作業の記録の列と、まとめた工事の行", () => {
  const ledger = csv(["名称,系列", "ポンプ,1号", "ブロワ,1号"]);
  const daily = csv([
    "作業日,号炉,設備名,作業区分,作業内容,人数,作業時間(h)",
    "2022/05/10,1号,ポンプ,点検,軸受交換,2,4",
    "2022/05/11,1号,ブロワ,点検,ベルト交換,2,4",
    "2022/05/12,1号,1号定期工事,工事,一式（内訳は各行）,,",
  ]);

  test("「作業区分」は区分の列、「作業内容」が作業の名前の列", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const t = s.analyze().layouts.find((l) => l.file === "日報.csv")?.tables[0];
    const role = (h: string) => t?.cols.find((c) => c.header === h)?.role;
    expect(role("作業内容")).toBe("workName");
    expect(role("作業区分")).toBe("remark");
  });

  test("作業の欄が一式だけの行は、作業にせず記録に残すのを推す 1 問。推した答えで計画ができ、その行は理由つきで外れる", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const q = s.analyze().open.find((x) => x.text.includes("一式だけ"));
    expect(q?.kind).toBe("eventAsset");
    expect(q?.defaultAnswer).toBe("exclude");
    expect(q?.options.map((o) => o.id)).toEqual(["exclude", "split"]);
    expect(s.analyze().open.some((x) => x.kind === "eventAssetOne")).toBe(false);
    acceptDefaults(s);
    const an = s.analyze();
    expect(an.open).toEqual([]);
    expect(an.composition.plan).not.toBeNull();
    // 外した行は理由ごとに数える（黙って捨てない）
    const fc = an.composition.counts.find((x) => x.file === "日報.csv");
    expect(fc?.excludedRows["まとめた工事の行（作業の欄が一式だけ。決定で外した）"]).toBe(1);
  });

  test("「1 件ずつ機器を選ぶ」と答えれば、これまでどおり 1 件ずつの問いになる", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const q = s.analyze().open.find((x) => x.text.includes("一式だけ"));
    s.settle([{ questionId: q?.questionId ?? "", answer: "split", author: "human", reason: "試験の台本が押した" }]);
    // 名前の同じ機器が無い名前の 1 問（新しい機器にするか）に、1 件ずつ選ぶと答える
    const none = s.analyze().open.find((x) => x.kind === "eventAsset" && x.items.some((it) => it.note === "1号定期工事"));
    expect(none?.options.map((o) => o.id)).toEqual(["new", "split", "exclude"]);
    s.settle([{ questionId: none?.questionId ?? "", answer: "split", author: "human", reason: "試験の台本が押した" }]);
    expect(s.analyze().open.some((x) => x.kind === "eventAssetOne" && x.text.includes("1号定期工事"))).toBe(true);
  });
});

describe("先の資料より、この資料の方が同じ名前の機器が多い", () => {
  test("同じ親の下の同じ名前の 2 行を、先の資料の 1 行に結ばない案を推す 1 問", async () => {
    const ledger = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["名称", "系列"],
        ["クレーン", null],
        ["　巻上装置", null],
      ]);
    }, "台帳");
    const chart = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["設備", "機器", "点検内容", "2022", "2023"],
        ["クレーン", null, null, null, null],
        [null, "巻上装置", "点検", "○", null],
        [null, "巻上装置", "点検", null, "○"],
      ]);
    }, "計画");
    const s = session();
    await s.add([
      { name: "台帳.xlsx", bytes: ledger },
      { name: "計画.xlsx", bytes: chart },
    ]);
    // 結ぶ問いのほかは、推した答え（凡例の無い記号は計画）で答えてから見る
    for (let i = 0; i < 5; i++) {
      const rest = s.analyze().open.filter((x) => x.kind !== "assetLink" && x.kind !== "assetLinkOne" && x.kind !== "assetUnmatched" && !x.decision);
      if (!rest.length) break;
      s.settle(rest.map((x) => ({ questionId: x.questionId, answer: x.kind === "noLegend" ? "plan" : (x.defaultAnswer ?? ""), author: "human" as const, reason: "試験の台本が押した" })));
    }
    const open = s.analyze().open;
    const q = open.find((x) => x.kind === "assetLink" && x.options.some((o) => o.id === "none"));
    expect(q, open.map((x) => `${x.kind}:${x.text}`).join("\n")).toBeDefined();
    if (!q) return;
    expect(q.defaultAnswer).toBe("none");
    expect(open.some((x) => x.kind === "assetLinkOne")).toBe(false);
  });
});
