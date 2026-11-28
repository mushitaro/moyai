// 読み方の規則の効いたセルの数え方（RuleHits）：シートごとに数える。シートは番号か字で渡し、位置（located）に入れるのは番号で渡したセルだけ。
import { describe, expect, test } from "vitest";
import { RuleHits, type ReadingRule } from "../../../src/import/reading";

const rule: ReadingRule = { id: "r", text: "試験", author: "ai", reason: "試験", kind: "headerRow", row: 1 };

describe("RuleHits", () => {
  test("同じ位置のセルでも、シートが違えば別に数える（番号でも字でも）", () => {
    const h = new RuleHits();
    h.add(rule, "日報.xlsx", "B3", 0);
    h.add(rule, "日報.xlsx", "B3", 1);
    h.add(rule, "日報.xlsx", "B3", 1);
    expect(h.count("r")).toBe(2);
    const n = new RuleHits();
    n.add(rule, "日報.xlsx", "B3", "6.5");
    n.add(rule, "日報.xlsx", "B3", "6.6");
    expect(n.count("r")).toBe(2);
    expect(n.rows("r")).toBe(2);
  });
  test("位置（located）に入れるのは、番号で渡したセルだけ。シートが分からないセルは資料と位置で数える", () => {
    const h = new RuleHits();
    h.add(rule, "日報.xlsx", "B3", 0);
    h.add(rule, "日報.xlsx", "C3", "#1");
    h.add(rule, "台帳.csv", "A2", null);
    h.add(rule, "台帳.csv", "A2");
    expect(h.count("r")).toBe(3);
    expect([...h.located("r")]).toEqual(["日報.xlsx\u00000\u0000B3"]);
    expect(h.sample("r")).toEqual({ file: "日報.xlsx", ref: "B3" });
  });
});
