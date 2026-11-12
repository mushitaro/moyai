// 初めて読む物差しの道具（tests/heldout/first-read.ts）：年度の分け方と、1 年目の答えから作る決まった答えの規則
import { describe, expect, it } from "vitest";
import { ReadingRule } from "../../src/import/reading";
import { rulesFromAnswers, yearSplit } from "../heldout/first-read";

describe("初めて読む物差しの道具", () => {
  it("年度が 1 つだけの名前を年度ごとにまとめ、いちばん多い年度（同じなら新しい年度）と範囲・年度の無い資料を 1 年目にする", () => {
    const s = yearSplit(["日報_R6.xlsx", "日報_R7.xlsx", "台帳_H28-R7.xlsx", "機器台帳.xlsx"]);
    expect(s).toEqual({ year: "R7", first: ["台帳_H28-R7.xlsx", "機器台帳.xlsx", "日報_R7.xlsx"], rest: ["日報_R6.xlsx"], restYears: 1 });
    expect(yearSplit(["実績_2024.csv", "実績_2025.csv", "実績_2025_追加.csv"])?.year).toBe("2025");
    // 年度が 1 つしか無い・範囲だけなら分けない
    expect(yearSplit(["計画_R2-R12.xlsx", "機器台帳.xlsx"])).toBeNull();
    expect(yearSplit(["日報_R7.xlsx", "台帳.xlsx"])).toBeNull();
  });

  it("答えを、資料の名前と年度によらない match の規則にする。資料を丸ごと外す答えは作らない。型に合う", () => {
    const files = ["【架空】甲_実績_2021.csv", "【架空】甲_実績_2022.csv"];
    const qs = [
      { questionId: "q1", kind: "eventAssetOne", text: "【架空】甲_実績_2021.csv の機器「ごみクレーン A号機」（号の欄が空）に、名前の同じ機器が無い（1 行）。どの機器か" },
      { questionId: "q2", kind: "workLinkOne", text: "【架空】甲_実績_2021.csv の作業「定期点検」（灰クレーン、2021 年度、1 行）に当たる星取が、いくつかある" },
      { questionId: "q3", kind: "subtotalMismatch", text: "小計の行のうち、表の中身から数えた値と合わない列がある行（7 行）" },
      { questionId: "q4", kind: "reference", text: "【架空】甲_実績_2022.csv を参考として外すか" },
      { questionId: "q5", kind: "eventAssetOne", text: "答えていない問い「X」" },
    ];
    const rules = rulesFromAnswers(qs, [
      { questionId: "q1", answer: "c10" },
      { questionId: "q2", answer: "m0" },
      { questionId: "q3", answer: "exclude" },
      { questionId: "q4", answer: "reference" },
    ], files);
    expect(rules.map((r) => (r.kind === "answer" ? [r.question, r.match, r.answer] : null))).toEqual([
      ["eventAssetOne", "「ごみクレーン A号機」（号の欄が空）", "c10"],
      ["workLinkOne", "「定期点検」（灰クレーン、", "m0"],
      ["subtotalMismatch", "小計の行のうち、表の中身から数えた値と合わない列がある行", "exclude"],
    ]);
    for (const r of rules) expect(ReadingRule.safeParse(r).success).toBe(true);
  });
});
