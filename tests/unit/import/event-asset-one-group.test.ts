// 作業の記録の機器の候補がいくつもある名前の問い（docs/plan.md §2.6：直してよいのは一般の手がかりと一般の質問の形だけ）。どの業種の語にも依らない架空の小さな資料。
// - 同じ様式の日報を何冊も入れたとき、同じ名前・同じ号・同じ候補の名前は、冊ごとではなく 1 問。答えはその名前のどの冊の行にも当てる
// - 候補が違えば（号が違えば）別の問い
import { describe, expect, test } from "vitest";
import { human, session } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
const ledger = csv(["設備,名称,系列", "甲設備,ブロワ,1号", "乙設備,ブロワ,1号", "甲設備,ブロワ,2号", "乙設備,ブロワ,2号"]);
const daily = (d: string, unit: string) => csv(["日付,炉,機器,作業,工数", `2024/4/${d},${unit},ブロワ,点検,延べ2人`]);

describe("候補がいくつもある名前は、同じ様式の冊をまたいで 1 問", () => {
  test("3 冊の日報の同じ名前・同じ号は 1 問。答えは 3 冊の行に当たる。号が違えば別の問い", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報_1.csv", bytes: daily("6", "1") },
      { name: "日報_2.csv", bytes: daily("7", "1") },
      { name: "日報_3.csv", bytes: daily("8", "1") },
      { name: "日報_4.csv", bytes: daily("9", "2") },
    ]);
    const one = s.analyze().open.filter((q) => q.kind === "eventAssetOne");
    expect(one.map((q) => q.text.match(/（(\d+) 号）/)?.[1]).sort()).toEqual(["1", "2"]);
    const q1 = one.find((q) => q.text.includes("（1 号）"));
    expect(q1?.text).toContain("3 行");
    s.settle([human(q1?.questionId ?? "", "c0")]);
    const q2 = s.analyze().open.find((q) => q.kind === "eventAssetOne");
    s.settle([human(q2?.questionId ?? "", "exclude")]);
    const an = s.analyze();
    expect(an.open).toEqual([]);
    const plan = an.composition.plan;
    const target = plan?.works.find((w) => w.targets.length)?.targets[0];
    const ds = plan?.details.filter((d) => plan.works.find((w) => w.workKey === d.workKey)?.targets.includes(target ?? "?")) ?? [];
    expect(new Set(ds.flatMap((d) => d.sources.map((x) => x.file)).filter((f) => f.startsWith("日報"))).size).toBe(3);
  });
});
