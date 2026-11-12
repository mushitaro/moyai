// 読み方のフィードバックの書き出し（S-C3）：形と数だけ・固有名詞の網 2 で止める・Issue に貼れば C1 の台本（scripts/skill-loop/feedback.mjs）の同じ道に乗る
import { describe, expect, it } from "vitest";
import { ReadingSkill, type LoadedReading } from "../../../src/import/reading";
import { buildReadingFeedback, READING_FEEDBACK_SCHEMA } from "../../../src/share/reading-feedback";
// @ts-expect-error 型の無い .mjs（台本）
import { buildCandidate, screen } from "../../../scripts/skill-loop/feedback.mjs";

const loaded = (rules: unknown[], scope: "facility" | "company" = "facility"): LoadedReading => ({
  skill: ReadingSkill.parse({ schema: "moyai.reading/0", name: "施設の読み方", scope, rules }),
  version: "v",
  path: null,
  approved: false,
  draft: true,
});
const RULES = [
  { id: "drain", kind: "answer", question: "assetLinkOne", match: "「排水処理設備」に当たる機器が先の資料に 1 つある", answer: "c0", text: "機器台帳の「排水処理設備」を同じ機器として読む", author: "human", by: "担当のだれか", reason: "とても長い自由記述の理由。施設の事情が書いてある", when: { file: "*機器台帳*", headers: ["機器名称"] } },
  { id: "unit", kind: "columnRole", column: "号炉", role: "unit", text: "「号炉」の列を号炉として読む", author: "ai", reason: "理由" },
];

describe("読み方のフィードバックの書き出し", () => {
  it("形と数だけを書き出す：文・理由・人・資料の名前・id・範囲を入れない", () => {
    const r = buildReadingFeedback({ pack: "waste-incineration", readings: [loaded(RULES)], cellsOf: (id) => (id === "drain" ? 2 : 40), localWords: ["ひかり台クリーンプラザ"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.schema).toBe(READING_FEEDBACK_SCHEMA);
    expect(r.file.rules).toEqual([
      { kind: "answer", question: "assetLinkOne", match: "「排水処理設備」に当たる機器が先の資料に 1 つある", answer: "c0", when: { headers: ["機器名称"] } },
      { kind: "columnRole", column: "号炉", role: "unit" },
    ]);
    expect(r.file.cells).toEqual([2, 40]);
    for (const v of ["担当のだれか", "自由記述", "機器台帳*", "drain", "facility", "同じ機器として読む"]) expect(r.text).not.toContain(v);
  });

  it("同じ形の規則は 1 つにまとめ、規則が無ければ作らない", () => {
    const r = buildReadingFeedback({ pack: "p", readings: [loaded([RULES[1]]), loaded([{ ...RULES[1], id: "unit2" }], "company")], cellsOf: () => 1, localWords: [] });
    expect(r.ok && r.file.rules.length).toBe(1);
    expect(buildReadingFeedback({ pack: "p", readings: [loaded([])], cellsOf: () => 0, localWords: [] })).toEqual({ ok: false, reason: "noRules" });
  });

  it("その PC の語（施設名・業者など）が形の欄に入っていれば作らない。当たった語は返さない", () => {
    const rules = [{ id: "s", kind: "sameAsset", names: ["ひかり台の1号クレーン", "ごみクレーン"], text: "同じ機器", author: "human", reason: "理由" }];
    const r = buildReadingFeedback({ pack: "p", readings: [loaded(rules)], cellsOf: () => 3, localWords: ["ひかり台"] });
    expect(r).toEqual({ ok: false, reason: "properNoun", hits: 1 });
    expect(JSON.stringify(r)).not.toContain("ひかり台");
  });

  it("書き出したファイルを Issue に貼ると、C1 の台本の同じ道に乗り、案は moyai.reading/0 として読める", () => {
    const r = buildReadingFeedback({ pack: "waste-incineration", readings: [loaded(RULES)], cellsOf: () => 1, localWords: [] });
    if (!r.ok) throw new Error("作れない");
    const body = ["### 業種（Skillパック）", "", "ごみ焼却（waste-incineration）", "", "### 資料の種類", "", "機器台帳", "", "### どう読まれて、どう読まれるべきだったか", "", "アプリから書き出した。", "", "### 会話で作ったルール（あれば）", "", "```json", r.text.trim(), "```", "", "### 確かめ", "", "- [X] 資料の中身（行の値・金額・固有名詞）を書いていない", ""].join("\n");
    const s = screen({ number: 9100, title: "書き出したルール", body, labels: ["feedback"] });
    expect(s.ok).toBe(true);
    const cand = buildCandidate(9100, s.pack, s.rules);
    const parsed = ReadingSkill.parse({ scope: "company", ...cand });
    expect(parsed.rules.map((x) => x.id)).toEqual(["fb9100-app1", "fb9100-app2"]);
    expect(parsed.rules.every((x) => x.author === "ai")).toBe(true);
  });
});
