// 台帳を根拠にした周期の案（Architect の 52）：橋渡しが照らした集計（項目・作業分類・似た施設の数・帯）に合う作業と年数にだけ L の案を置き、
// 数は MOYAI が根拠に書く（AI の文の数は使わない）。ほかの項目・作業分類の作業には台帳の根拠を付けない
import { describe, expect, it } from "vitest";
import { proposeCycles, type VerifiedBases } from "../../src/plan/cycle";
import { bandSpan } from "../../src/share/bands";
import type { Rule } from "../../src/shared/tools";
import { asset, detail, plan, work } from "./share/fixtures";

const p = () =>
  plan({
    assets: [asset("a1", "WI.A"), asset("a2", "WI.B")],
    works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "OVERHAUL", ["a2"]), work("w3", "INSPECT", ["a1"])],
    details: [detail("d1", "w1", 2020), detail("d2", "w2", 2020), detail("d3", "w3", 2020), detail("d4", "w1", 2032, { planOrActual: "plan" })],
  });
// どの作業にも当たる規則（AI が広く書いた）
const all = (years: number): Rule => ({ when: [], set: { field: "work.trigger", value: years }, reason: "台帳" });
const ledger: NonNullable<VerifiedBases["ledger"]> = { version: "abcdef012345", commonItem: "WI.A", work: "OVERHAUL", n: 6, median: "I3", q1: "I2", q3: "I4" };

describe("台帳を根拠にした周期の案", () => {
  it("帯のコードの幅", () => {
    expect(bandSpan("I5")).toEqual({ lo: 5, hi: 5 });
    expect(bandSpan("I6_7")).toEqual({ lo: 6, hi: 7 });
    expect(bandSpan("W1000P")).toEqual({ lo: 1000, hi: Infinity });
    expect(bandSpan("x")).toBeNull();
  });

  it("照らした項目と作業分類の作業にだけ置き、根拠の数は MOYAI が書く", () => {
    const r = proposeCycles(p(), [all(3)], { nextId: () => "L1", basis: "公開の台帳・似た施設 99", fromLedger: true, verified: { ledger } });
    if (!r.ok) throw new Error(r.code);
    const added = r.plan.details.filter((d) => d.detailKey.startsWith("cy-L1-"));
    expect([...new Set(added.map((d) => d.workKey))]).toEqual(["w1"]);
    expect(added[0]!.basis).toContain("公開台帳（版 abcdef012345）：類似施設 6、間隔の中央値 3 年、四分位 2〜4 年");
  });

  it("年数が四分位の帯の外なら置かない", () => {
    for (const y of [1, 5]) {
      const r = proposeCycles(p(), [all(y)], { nextId: () => "L1", basis: "公開の台帳", fromLedger: true, verified: { ledger } });
      expect(r, String(y)).toEqual({ ok: false, code: "ledger_basis_mismatch", ruleIndex: 0 });
    }
  });
});

describe("周期の案の規則の条件（Architect の 47）", () => {
  it("作業の年度の値・計量値の欄の条件は効かないので断る", () => {
    const r = proposeCycles(p(), [{ when: [{ field: "workDetail.fiscalYear", op: "equals", values: ["2020"] }], set: { field: "work.trigger", value: 3 }, reason: "x" }], { nextId: () => "C1", basis: "会話", fromLedger: false });
    expect(r).toEqual({ ok: false, code: "rule_invalid", ruleIndex: 0 });
  });
});
