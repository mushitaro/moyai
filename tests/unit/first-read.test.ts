// 初めて読む物差しの道具（tests/heldout/first-read.ts）：年度の分け方と、1 年目の答えから作る決まった答えの規則
import { describe, expect, it } from "vitest";
import { Asker } from "../../src/import/questions";
import { ReadingRule, type ActiveRule } from "../../src/import/reading";
import { answerShape, rulesFromAnswers, yearSplit } from "../heldout/first-read";

describe("初めて読む物差しの道具", () => {
  it("年度が 1 つだけの名前を年度ごとにまとめ、いちばん多い年度（同じなら新しい年度）と範囲・年度の無い資料を 1 年目にする", () => {
    const s = yearSplit(["日報_R6.xlsx", "日報_R7.xlsx", "台帳_H28-R7.xlsx", "機器台帳.xlsx"]);
    expect(s).toEqual({ year: "R7", first: ["台帳_H28-R7.xlsx", "機器台帳.xlsx", "日報_R7.xlsx"], rest: ["日報_R6.xlsx"], restYears: 1 });
    expect(yearSplit(["実績_2024.csv", "実績_2025.csv", "実績_2025_追加.csv"])?.year).toBe("2025");
    // 年度が 1 つしか無い・範囲だけなら分けない
    expect(yearSplit(["計画_R2-R12.xlsx", "機器台帳.xlsx"])).toBeNull();
    expect(yearSplit(["日報_R7.xlsx", "台帳.xlsx"])).toBeNull();
  });

  it("答えを、資料の名前によらない match の規則にする。シートの名前の「」は使わない。資料を丸ごと外す答えは作らない。型に合う", () => {
    const files = ["【架空】甲_実績_2021.csv", "【架空】甲_実績_2022.csv", "【架空】甲_台帳.xlsx"];
    const qs = [
      { questionId: "q1", kind: "eventAssetOne", text: "【架空】甲_実績_2021.csv の機器「ごみクレーン A号機」（号の欄が空）に、名前の同じ機器が無い（1 行）。どの機器か" },
      { questionId: "q2", kind: "subtotalMismatch", text: "小計の行のうち、表の中身から数えた値と合わない列がある行（7 行）（7 問をまとめた：【架空】甲_台帳.xlsx「H29年度」・【架空】甲_台帳.xlsx「H30年度」 ほか 5 か所）" },
      { questionId: "q3", kind: "reference", text: "【架空】甲_実績_2022.csv を参考として外すか" },
      { questionId: "q4", kind: "eventAssetOne", text: "答えていない問い「X」" },
    ];
    const rules = rulesFromAnswers(qs, [
      { questionId: "q1", answer: "c10" },
      { questionId: "q2", answer: "exclude" },
      { questionId: "q3", answer: "reference" },
    ], files);
    expect(rules.map((r) => (r.kind === "answer" ? [r.question, r.match, r.answer] : null))).toEqual([
      ["eventAssetOne", "「ごみクレーン A号機」（号の欄が空）に、名前の同じ機器が無い（1 行）。どの機器か", "c10"],
      ["subtotalMismatch", "小計の行のうち、表の中身から数えた値と合わない列がある行（7 行）（7 問をまとめた：", "exclude"],
    ]);
    for (const r of rules) expect(ReadingRule.safeParse(r).success).toBe(true);
  });

  it("種類ごとに広げない（同じ答えが続いても、問いごとの規則だけ）。年度や数だけが違って答えの分かれた問いは、規則にしない", () => {
    const text = (name: string) => `【架空】甲_実績_2021.csv の機器「${name}」（号の欄が空）に、名前の同じ機器が無い（1 行）。どの機器か`;
    const names = ["A", "B", "C", "D", "E", "F"];
    const qs = names.map((n, i) => ({ questionId: `q${i}`, kind: "eventAssetOne", text: text(`機器${n}`) }));
    const rules = rulesFromAnswers(qs, names.map((_, i) => ({ questionId: `q${i}`, answer: "exclude" })), ["【架空】甲_実績_2021.csv"]);
    expect(rules).toHaveLength(names.length);
    expect(rules.every((r) => r.kind === "answer" && r.match.startsWith("「機器"))).toBe(true);
    const twin = [
      { questionId: "y1", kind: "workLinkOne", text: "作業「定期点検」（No.1、2021 年度、1 行）に当たる星取が、いくつかある" },
      { questionId: "y2", kind: "workLinkOne", text: "作業「定期点検」（No.1、2022 年度、3 行）に当たる星取が、いくつかある" },
    ];
    expect(rulesFromAnswers(twin, [{ questionId: "y1", answer: "m0" }, { questionId: "y2", answer: "eventOnly" }], [])).toEqual([]);
    expect(answerShape("作業「点検」（No.1、2021 年度、5 行）")).toBe("作業「点検」(No.1、#、#)");
  });
});

describe("決まった答えの規則の当て方（読み手の側。src/import/questions.ts の ruleFor）", () => {
  const q = (text: string) => ({ kind: "workLinkOne" as const, text, sameShapeRows: 1, defaultAnswer: null, valueKind: "option" as const, options: [{ id: "eventOnly", label: "外す" }, { id: "m0", label: "結ぶ" }], items: [] });
  const rule: ActiveRule = { rule: { id: "y1-1", kind: "answer", question: "workLinkOne", match: "「点検」（No.1、2021 年度、5 行）", answer: "eventOnly", text: "1 年目の答え", author: "ai", reason: "試験" }, from: { name: "y1", version: "", scope: "facility", approved: false, draft: true } };
  it("そのままの字で含む問いにだけ当たる。年度や行の数だけが違う問いには当てず、聞く（違う答えより聞く側に倒す）", () => {
    const qs = new Asker(new Map(), [rule]);
    expect(qs.ask("a", q("作業「点検」（No.1、2021 年度、5 行）に当たる星取が"))).toBe("eventOnly");
    expect(qs.ask("b", q("作業「点検」（No.1、2022 年度、3 行）に当たる星取が"))).toBeNull();
  });
});
