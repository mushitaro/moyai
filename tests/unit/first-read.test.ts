// 初めて読む物差しの道具（tests/heldout/first-read.ts）：年度の分け方と、1 年目の答えから作る決まった答えの規則
import { describe, expect, it } from "vitest";
import { ReadingRule, answerMatches, answerShape } from "../../src/import/reading";
import { commonPiece, rulesFromAnswers, yearSplit } from "../heldout/first-read";

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

  it("種類ごとの規則：5 問以上で、候補を指さない同じ答えが 9 割以上なら、共通の文で 1 つ足す（名前ごとの規則のあと）。候補を指す答えや、答えの分かれた形は広げない", () => {
    const text = (name: string, go: string) => `【架空】甲_実績_2021.csv の機器「${name}」（${go}）に、名前の同じ機器が無い（1 行）。どの機器か`;
    const names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const qs = names.map((n, i) => ({ questionId: `q${i}`, kind: "eventAssetOne", text: text(`機器${n}`, i % 2 ? "1 号" : "号の欄が空") }));
    const answered = names.map((_, i) => ({ questionId: `q${i}`, answer: i === 0 ? "c3" : "exclude" }));
    const rules = rulesFromAnswers(qs, answered, ["【架空】甲_実績_2021.csv"]);
    const last = rules.at(-1)!;
    expect(last.kind === "answer" && [last.question, last.answer]).toEqual(["eventAssetOne", "exclude"]);
    expect(last.kind === "answer" && last.match).toBe(")に、名前の同じ機器が無い(");
    expect(rules).toHaveLength(names.length + 1);
    // 候補を指す答えが多ければ（9 割に届かない）、種類ごとの規則は作らない
    const mixed = names.map((_, i) => ({ questionId: `q${i}`, answer: i < 3 ? `c${i}` : "exclude" }));
    expect(rulesFromAnswers(qs, mixed, ["【架空】甲_実績_2021.csv"])).toHaveLength(names.length);
    // 年度だけが違い、答えの分かれた問いは、どちらも規則にしない
    const twin = [
      { questionId: "y1", kind: "workLinkOne", text: "作業「定期点検」（No.1、2021 年度、1 行）に当たる星取が、いくつかある" },
      { questionId: "y2", kind: "workLinkOne", text: "作業「定期点検」（No.1、2022 年度、3 行）に当たる星取が、いくつかある" },
    ];
    expect(rulesFromAnswers(twin, [{ questionId: "y1", answer: "m0" }, { questionId: "y2", answer: "eventOnly" }], [])).toEqual([]);
    expect(commonPiece(["ab#cdefghij", "x#cdefghijk", "zz"], 0.6)).toBe("cdefghij");
  });
});

describe("決まった答えの規則の比べ（読み手の側。src/import/reading.ts）", () => {
  it("年度・日付・行や件の数を伏せて比べる。号・No. の番号は伏せない", () => {
    expect(answerShape("作業「点検」（No.1、2021 年度、5 行）")).toBe("作業「点検」(No.1、#、#)");
    expect(answerShape("R7 年度・令和 6 年度・2024/04/01・4月1日・12 件・3 冊・444 通り")).toBe("#・#・#・#・#・#・#");
    expect(answerShape("機器「IDF」（2 号）")).toBe("機器「IDF」(2 号)");
    expect(answerMatches("作業「点検」（No.1、2022 年度、3 行）に当たる", "「点検」（No.1、2021 年度、5 行）")).toBe(true);
    expect(answerMatches("作業「点検」（No.2、2022 年度、3 行）に当たる", "「点検」（No.1、2021 年度、5 行）")).toBe(false);
    expect(answerMatches("機器「IDF」（2 号）に", "「IDF」（1 号）に")).toBe(false);
    // そのままの字で含むときは、伏せずに当たる（前と同じ）
    expect(answerMatches("「年度」も「年」も無い", "「年度」も")).toBe(true);
  });
});
