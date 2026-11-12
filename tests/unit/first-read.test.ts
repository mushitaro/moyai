// 初めて読む物差しの道具（tests/heldout/first-read.ts）：年度の分け方と、1 年目の答えから作る決まった答えの規則
import { describe, expect, it } from "vitest";
import { Asker } from "../../src/import/questions";
import { ReadingRule, countShape, wideShape, type ActiveRule } from "../../src/import/reading";
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
      ["subtotalMismatch", "小計の行のうち、表の中身から数えた値と合わない列がある行（7 行）", "exclude"],
    ]);
    for (const r of rules) expect(ReadingRule.safeParse(r).success).toBe(true);
  });

  it("選択肢を choices に写す。まとめた問いは「（n 問をまとめた：…）」を外してから match を選ぶ（その中の資料の名前の後ろを match にしない）", () => {
    const files = ["【架空】甲_工程表_R3-R7.xlsx"];
    const rules = rulesFromAnswers(
      [{ questionId: "q1", kind: "stray", text: "【架空】甲_工程表_R3-R7.xlsx（同じ様式）の工程表に、名前も作業も無い行がある（15 行）（5 問をまとめた：【架空】甲_工程表_R3-R7.xlsx「R3」・【架空】甲_工程表_R3-R7.xlsx「R4」 ほか 3 か所）", options: [{ label: "外す" }] }],
      [{ questionId: "q1", answer: "exclude" }],
      files,
    );
    expect(rules.map((r) => (r.kind === "answer" ? [r.match, r.choices] : null))).toEqual([["（同じ様式）の工程表に、名前も作業も無い行がある（15 行）", ["外す"]]]);
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
  it("そのままの字か、くり返しの数（行・問・か所）だけが違う問いに当たる。年度・番号・中身の数（何通り・何件）が違う問いには当てず、聞く（違う答えより聞く側に倒す）", () => {
    const qs = new Asker(new Map(), [rule]);
    expect(qs.ask("a", q("作業「点検」（No.1、2021 年度、5 行）に当たる星取が"))).toBe("eventOnly");
    expect(qs.ask("c", q("作業「点検」（No.1、2021 年度、12 行）に当たる星取が"))).toBe("eventOnly");
    expect(qs.ask("b", q("作業「点検」（No.1、2022 年度、3 行）に当たる星取が"))).toBeNull();
    expect(qs.ask("d", q("作業「点検」（No.2、2021 年度、5 行）に当たる星取が"))).toBeNull();
    expect(countShape("機器の名前 6 通り（8 行）・契約 9 件・2 問をまとめた・ほか 3 か所")).toBe("機器の名前 6 通り(#)・契約 9 件・#をまとめた・ほか #");
  });
  it("choices のある規則は、選択肢が同じ問いにだけ、年度も伏せて当たる。選択肢が違う・号が違う問いには当てない", () => {
    const opts = [{ id: "eventOnly", label: "外す" }, { id: "m0", label: "星取「●」（点検）も出どころにする" }];
    const withChoices: ActiveRule = { rule: { ...rule.rule, choices: opts.map((o) => o.label) } as ReadingRule, from: rule.from };
    const ask = (key: string, text: string, options = opts) => new Asker(new Map(), [withChoices]).ask(key, { ...q(text), options });
    expect(ask("a", "作業「点検」（No.1、2022 年度、3 行）に当たる星取が")).toBe("eventOnly");
    expect(ask("b", "作業「点検」（No.1、2022 年度、3 行）に当たる星取が", [opts[0]!, { id: "m0", label: "星取「●」（整備）も出どころにする" }])).toBeNull();
    expect(ask("c", "作業「点検」（No.2、2022 年度、3 行）に当たる星取が")).toBeNull();
    expect(new Asker(new Map(), [rule]).ask("d", q("作業「点検」（No.1、2022 年度、3 行）に当たる星取が"))).toBeNull();
    expect(wideShape("R7 年度・2025 年度・2025/4/1・作業 9 件（9 行）・No.2")).toBe("#・#・#・作業 9 件(#)・No.2");
  });
  it("choices のある規則で、まとめた中身の数（何件・何通り）は、1 件ずつ選ぶ選択肢（split）の無い問いでだけ伏せる", () => {
    const yesEx = [{ id: "yes", label: "入れる" }, { id: "exclude", label: "外す" }];
    const yesSplit = [{ id: "yes", label: "はい（まとめて当てる）" }, { id: "split", label: "いいえ（1 件ずつ聞く）" }];
    const lump = (options: typeof yesEx): ActiveRule => ({ rule: { id: "y1-3", kind: "answer", question: "workLink", match: "の作業 2 件（2 行）は、星取が無い", answer: "yes", choices: options.map((o) => o.label), text: "1 年目の答え", author: "ai", reason: "試験" }, from: rule.from });
    const ask = (options: typeof yesEx) => new Asker(new Map(), [lump(options)]).ask("a", { ...q("甲 と 乙 の作業 9 件（26 行）は、星取が無い"), kind: "workLink", options });
    expect(ask(yesEx)).toBe("yes");
    expect(ask(yesSplit)).toBeNull();
  });
  it("まとめた問いは、まとめた文でも規則を当てる（1 年目の答えの規則は、人と Claude に見せたまとめた文から作る）", () => {
    const merged: ActiveRule = { rule: { id: "y1-2", kind: "answer", question: "workLinkOne", match: "まとめた文の「点検」", answer: "eventOnly", text: "1 年目の答え", author: "ai", reason: "試験" }, from: { name: "y1", version: "", scope: "facility", approved: false, draft: true } };
    const qs = new Asker(new Map(), [merged]);
    expect(qs.ask("m1", q("ばらの文"), { key: "k", text: (rows) => `まとめた文の「点検」（${rows} 行）` })).toBe("eventOnly");
    expect(new Asker(new Map(), [merged]).ask("m2", q("ばらの文"), { key: "k" })).toBeNull();
  });
});
