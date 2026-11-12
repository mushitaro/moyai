// 星の詳細の判断の履歴（mushitaro/moyai#29 の残り）：確定のシートで人が受けた決定（その明細・作業・機器とその上の節）を、
// 保管先の版の記録（版と理由）と今の作業で受けたものに分けて並べる。決定の ID と理由と版だけ（行の値は持たない）
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionHistory, type Index } from "../../src/app/pages/StarTable";
import { acceptHistoryFor, setAcceptHistory } from "../../src/app/state/history";
import { acceptDecision, clearAccepted } from "../../src/app/state/decisions";

afterEach(() => {
  setAcceptHistory("", []);
  clearAccepted();
});

const ix: Index = {
  works: new Map(),
  assetName: (k) => k,
  assetChain: (k) => (k === "E24" ? ["E24", "G20"] : [k]),
  decidedBy: new Map(),
  workLabels: {} as Index["workLabels"],
};
const d = { detailKey: "d1", workKey: "w1" } as never;
const work = { workKey: "w1", targets: ["E24"] } as never;
const html = () => renderToStaticMarkup(
  <MantineProvider>
    <DecisionHistory d={d} work={work} planId="p1" ix={ix} />
  </MantineProvider>,
);

describe("判断の履歴", () => {
  it("その計画の、明細・作業・機器（上の節も）の決定だけを、版の古い順に", () => {
    setAcceptHistory("p1", [
      { id: "item:G20", hash: "a".repeat(16), reason: "上の節の項目を受けた", version: 2 },
      { id: "attr:w1", hash: "b".repeat(16), reason: "作業分類を受けた", version: 1 },
      { id: "attr:w9", hash: "c".repeat(16), reason: "ほかの作業", version: 1 },
    ]);
    expect(acceptHistoryFor("p1", ["attr:w1", "item:G20"]).map((x) => x.version)).toEqual([1, 2]);
    expect(acceptHistoryFor("other", ["attr:w1"])).toEqual([]);
    const h = html();
    expect(h).toContain("判断の履歴");
    expect(h).toContain("第 1 版　作業分類を受けた");
    expect(h).toContain("第 2 版　上の節の項目を受けた");
    expect(h).not.toContain("ほかの作業");
  });

  it("今の作業で受けた決定も並べる。どれも無ければ出さない", () => {
    expect(html()).toBe(renderToStaticMarkup(<MantineProvider>{null}</MantineProvider>));
    acceptDecision("detail:d1", "d".repeat(16), "画面で見て受けた");
    expect(html()).toContain("今の作業　画面で見て受けた");
  });
});
