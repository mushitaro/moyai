// 読み方（3 段目の Skill の規則。docs/plan.md §2.17）：規則の種類ごとに、読み手が当て、質問にしないこと。
// どの資料に効くか（見出しの文字・資料の名前）、効いたセルの数、規則で決めた作者と理由。架空の小さな資料で。
import { describe, expect, test } from "vitest";
import { READING_SCHEMA, ReadingSkill, activeRules, shortVersion, type LoadedReading, type ReadingRule } from "../../../src/import/reading";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
const base = { author: "ai" as const, reason: "利用者が会話で決めた" };
const reading = (rules: ReadingRule[], o: Partial<LoadedReading> = {}): LoadedReading => ({
  skill: { schema: READING_SCHEMA, name: "【架空】甲工場の読み方", scope: "facility", rules },
  version: "a1b2c3d4e5f6",
  path: null,
  approved: false,
  draft: true,
  ...o,
});
const ledger = csv(["名称,系列", "ポンプ,1号", "ブロワ,1号"]);
const daily = csv(["作業日,炉,機器,作業,時間(h)", "20240406,1,ポンプ,点検,16", "20240407,1,ブロワ,点検,8"]);

describe("読み方の形", () => {
  test("決まった形だけを受け、知らない種類・知らない欄は受けない", () => {
    const ok = { schema: READING_SCHEMA, name: "甲", scope: "company", rules: [{ ...base, id: "r1", text: "3 行目を見出しとして読む", kind: "headerRow", row: 3 }] };
    expect(ReadingSkill.safeParse(ok).success).toBe(true);
    expect(ReadingSkill.safeParse({ ...ok, rules: [{ ...ok.rules[0], kind: "script", code: "x" }] }).success).toBe(false);
    expect(ReadingSkill.safeParse({ ...ok, rules: [{ ...ok.rules[0], extra: 1 }] }).success).toBe(false);
    expect(ReadingSkill.safeParse({ ...ok, scope: "everyone" }).success).toBe(false);
    expect(shortVersion("a1b2c3d4e5f6")).toBe("a1b2 c3d4");
  });

  test("効く順は 施設 → 担当 → 会社。作業中の下書きは同じ段の承認済みより先", () => {
    const r = (scope: "facility" | "person" | "company", draft: boolean, id: string) =>
      reading([{ ...base, id, text: id, kind: "headerRow", row: 1 }], { skill: { schema: READING_SCHEMA, name: id, scope, rules: [{ ...base, id, text: id, kind: "headerRow", row: 1 }] }, draft });
    expect(activeRules([r("company", false, "c"), r("facility", false, "f"), r("person", false, "p"), r("facility", true, "fd")]).map((a) => a.rule.id)).toEqual(["fd", "f", "p", "c"]);
  });
});

describe("規則の種類ごとに、読み手が当てる", () => {
  test("日付の書き方（yyyymmdd）：規則が無ければ日付として読めず、規則で日付として読む。効いたセルを数える", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const before = s.analyze();
    expect(before.records.events.filter((e) => e.file === "日報.csv").every((e) => e.date === null)).toBe(true);
    expect(before.open.some((q) => q.kind === "dateUnknown")).toBe(true);
    const rule: ReadingRule = { ...base, id: "d1", text: "「作業日」の列の日付は yyyymmdd", kind: "dateFormat", column: "作業日", format: "yyyymmdd", when: { headers: ["作業日"] } };
    s.setReadings([reading([rule])]);
    const an = s.analyze();
    const t = an.layouts.find((l) => l.file === "日報.csv")?.tables[0];
    expect(t?.shape).toBe("events");
    expect(t?.cols[0]?.role).toBe("date");
    expect(an.records.events.filter((e) => e.file === "日報.csv").map((e) => `${e.date?.y}-${e.date?.m}-${e.date?.d}`)).toEqual(["2024-4-6", "2024-4-7"]);
    expect(an.ruleHits.count("d1")).toBe(2);
  });

  test("どの資料に効くか：見出しの文字がシートに無い資料には効かない", async () => {
    const s = session();
    await s.add([{ name: "日報.csv", bytes: daily }]);
    s.setReadings([reading([{ ...base, id: "d1", text: "「作業日」の列の日付は yyyymmdd", kind: "dateFormat", column: "作業日", format: "yyyymmdd", when: { headers: ["実施日"] } }])]);
    expect(s.analyze().ruleHits.count("d1")).toBe(0);
    s.setReadings([reading([{ ...base, id: "d1", text: "x", kind: "dateFormat", column: "作業日", format: "yyyymmdd", when: { file: "別の*.csv" } }])]);
    expect(s.analyze().ruleHits.count("d1")).toBe(0);
  });

  test("見出しの行・外す列・行の役割", async () => {
    const list = csv(["【架空】作業一覧", "出力条件,全件,並び,日付順,単位,時間", "日付,機器,作業,工数,担当", "2024/4/6,ポンプ,点検,延べ2人,甲", "2024/4/7,ブロワ,点検,延べ1人,乙", "年度計,,,3,"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "一覧.csv", bytes: list },
    ]);
    s.setReadings([
      reading([
        { ...base, id: "h", text: "3 行目を見出しとして読む", kind: "headerRow", row: 3, when: { file: "一覧.csv" } },
        { ...base, id: "x", text: "「担当」の列は個人名として外す", kind: "columnRole", column: "担当", role: "exclude" },
        { ...base, id: "t", text: "「年度計」の行は合計として外す", kind: "rowRole", match: "年度計", role: "total" },
      ]),
    ]);
    const an = s.analyze();
    const t = an.layouts.find((l) => l.file === "一覧.csv")?.tables[0];
    expect(t?.headerRows).toEqual([3]);
    expect(t?.rows.find((r) => r.r === 6)?.role).toBe("total");
    expect(an.composition.status.get("一覧.csv\u00000\u0000E4")?.s ?? an.composition.status.get([...an.composition.status.keys()].find((k) => k.endsWith("E4") && k.startsWith("一覧.csv")) ?? "")?.s).toBe("excluded");
    expect([an.ruleHits.count("h"), an.ruleHits.count("x"), an.ruleHits.count("t")]).toEqual([5, 2, 2]);
  });

  test("同じ機器（辞書）：書き方の違う名前を、台帳の機器に当てる", async () => {
    const d2 = csv(["日付,炉,機器,作業,工数", "2024/4/6,1,ブロワー,点検,延べ2人"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: d2 },
    ]);
    expect(s.analyze().open.some((q) => q.kind === "eventAssetOne" && q.text.includes("ブロワー"))).toBe(true);
    s.setReadings([reading([{ ...base, id: "a", text: "「ブロワー」と「ブロワ」は同じ機器", kind: "sameAsset", names: ["ブロワー", "ブロワ"] }])]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "eventAssetOne" && q.text.includes("ブロワー"))).toBe(false);
    expect(an.ruleHits.count("a")).toBe(1);
  });

  test("印の意味：凡例の無い星取表の ▲ △ を、規則の意味で読む", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["機器名称", "2024", "2025", "2026"]]);
      rows(ws, 2, [
        ["ポンプ", "▲", null, "△"],
        ["ブロワ", null, "▲", null],
      ]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    s.setReadings([reading([{ ...base, id: "m1", text: "▲ は実績", kind: "markMeaning", symbol: "▲", planOrActual: "actual" }, { ...base, id: "m2", text: "△ は予定", kind: "markMeaning", symbol: "△", planOrActual: "plan" }])]);
    acceptDefaults(s);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "noLegend" || q.kind === "unknownSymbol")).toBe(false);
    expect(an.records.marks.map((m) => `${m.ref}:${m.planOrActual}`).sort()).toEqual(["B2:actual", "C3:actual", "D2:plan"]);
  });

  test("決まった答え：人がまだ答えていない同じ質問に、規則の答え。作者は「決まり」、理由に読み方の名前と版。人の答えが先", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: csv(["日付,炉,機器,作業,時間(h)", "2024/4/6,1,ポンプ,点検,16"]) },
    ]);
    const q = s.analyze().open.find((x) => x.kind === "hoursPerManDay");
    expect(q).toBeTruthy();
    s.setReadings([reading([{ ...base, id: "q1", text: "「1 人・日を何時間」と聞かれたら、いつも 8", kind: "answer", question: "hoursPerManDay", match: "人・日", answer: "8" }])]);
    const d = s.analyze().questions.find((x) => x.questionId === q?.questionId)?.decision;
    expect(d?.author).toBe("rule_code");
    expect(d?.answer).toBe("8");
    expect(d?.reason).toContain("【架空】甲工場の読み方」版 a1b2 c3d4");
    s.settle([human(q?.questionId ?? "", "7.5")]);
    expect(s.analyze().questions.find((x) => x.questionId === q?.questionId)?.decision?.answer).toBe("7.5");
  });
});
