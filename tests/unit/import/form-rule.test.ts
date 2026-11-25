// 標準の読み手が表と読めない資料を、会話で決めた 3 段目の規則で読み切る（2026-11-25 運営者の困りごと「標準に合わないから資料を落とす方向に流れる」）。
// 帳票の型（kind: form）：1 日 1 枚の作業日報を、項目と値の欄と作業内容の行で読む。
// 契約の欄（kind: contractColumn）と、くり返しの見出しの行を別の表の見出しにする見出しの行（headerRow）：財務会計の書き出しの発注台帳を、契約の記録として読む。
// 資料はデモの資料（packs/waste-incineration/demo。どれも【架空】）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { IntakeSession } from "../../../src/import";
import { ReadingRule, type ReadingSkill } from "../../../src/import/reading";
import { formUnit, splitFormLine } from "../../../src/import/text";

const DIR = "packs/waste-incineration/demo";
const fileOf = (part: string) => readdirSync(DIR).find((f) => f.includes(part))!;
const REPORT = fileOf("作業日報");
const LEDGER = fileOf("財務会計CSV");

const base = { author: "ai" as const, reason: "利用者が会話で、この形で読むと答えた" };
const FORM = { ...base, id: "daily-form", kind: "form" as const, text: "「作業日報」の帳票は、「日付」を日付、「作業箇所」を号炉、「計」の「工数（人日）」をその日の工数、「作業内容」の下の行を 1 行 1 作業（頭の語が機器）として読む", title: "作業日報", fields: [{ label: "日付", role: "date" as const }, { label: "作業箇所", role: "unit" as const }, { label: "計", role: "effort" as const, column: "工数（人日）" }], lines: { label: "作業内容", split: "assetWork" as const } };
const LEDGER_RULES = [
  { ...base, id: "ledger-h2", kind: "headerRow" as const, text: "22 行目を「＜支出命令＞」の表の見出しとして読む", row: 22, when: { file: "*財務会計CSV.csv" } },
  { ...base, id: "c-title", kind: "contractColumn" as const, text: "「件名」を契約の件名として読む", column: "件名", field: "title" as const },
  { ...base, id: "c-vendor", kind: "contractColumn" as const, text: "「債権者名」を契約の相手として読む", column: "債権者名", field: "vendor" as const },
  { ...base, id: "c-date", kind: "contractColumn" as const, text: "「起票日」を契約の日として読む", column: "起票日", field: "orderDate" as const },
  { ...base, id: "c-amount", kind: "contractColumn" as const, text: "「金額」を契約の金額として読む", column: "金額", field: "orderAmount" as const },
  { ...base, id: "c-pay", kind: "contractColumn" as const, text: "「支払予定日」を支払の日として読む", column: "支払予定日", field: "payDate" as const },
  { ...base, id: "c-kind", kind: "contractColumn" as const, text: "「伝票区分」を契約の区分として読む", column: "伝票区分", field: "category" as const },
];

function session(rules: ReadingRule[]): IntakeSession {
  const s = new IntakeSession({ planId: "p", displayName: "【架空】試験", packId: "waste-incineration", facility: { facilityKey: "f", name: "【架空】さくら坂焼却場", fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null } });
  if (rules.length) {
    const skill: ReadingSkill = { schema: "moyai.reading/0", name: "【架空】さくら坂の読み方", scope: "facility", rules };
    s.setReadings([{ skill, version: "", path: null, approved: false, draft: true }]);
  }
  return s;
}
const add = (s: IntakeSession, f: string) => s.add([{ name: f, bytes: new Uint8Array(readFileSync(join(DIR, f))) }]);

describe("規則の形", () => {
  test("帳票の型と契約の欄は、型に通る（欄の外の字は断る）", () => {
    for (const r of [FORM, ...LEDGER_RULES]) expect(ReadingRule.safeParse(r).success, r.id).toBe(true);
    expect(ReadingRule.safeParse({ ...FORM, lines: { label: "作業内容", split: "guess" } }).success).toBe(false);
    expect(ReadingRule.safeParse({ ...LEDGER_RULES[1], field: "equipment" }).success).toBe(false);
  });
});

describe("帳票の作業の行の読み方", () => {
  test("頭の番号を除き、assetWork は括弧の外の最初の空白（か括弧のすぐ後）で機器と作業に分ける", () => {
    expect(splitFormLine("2. 給じん装置 シリンダ・摺動部の摩耗確認", "assetWork")).toEqual({ unit: null, asset: "給じん装置", work: "シリンダ・摺動部の摩耗確認" });
    expect(splitFormLine("1. 温水熱交換器（温水プール用） 外観・作動確認", "assetWork")?.asset).toBe("温水熱交換器(温水プール用)");
    expect(splitFormLine("2. ごみクレーン（常用・予備）年次点検：ワイヤ", "assetWork")).toMatchObject({ asset: "ごみクレーン(常用・予備)", work: "年次点検:ワイヤ" });
    expect(splitFormLine("1. 1号炉 誘引通風機 羽根車取替", "assetWork")).toMatchObject({ unit: { kind: "number", n: 1 }, asset: "誘引通風機", work: "羽根車取替" });
    expect(splitFormLine("3. 試運転", "assetWork")).toBeNull();
    expect(splitFormLine("3. 試運転", "work")).toEqual({ unit: null, asset: "", work: "試運転" });
  });
  test("号炉の欄は、どの項目も同じ号のときだけ号にする", () => {
    expect(formUnit("1号炉 ボイラ 清掃、1号炉 送風機")).toMatchObject({ kind: "number", n: 1 });
    expect(formUnit("2号炉 耐火物 点検、共通 ごみ")).toBeNull();
    expect(formUnit("共通 ごみ")).toEqual({ kind: "common" });
  });
});

describe("デモの作業日報（清書。日ごとに 1 シート）", () => {
  test("規則が無いと：見出しの欄が機器の節になり、作業は 0（読み手は変えていない）", async () => {
    const s = session([]);
    await add(s, REPORT);
    const r = s.analyze().records;
    expect(r.events.length).toBe(0);
    expect(r.assets.some((a) => a.name === "日　付")).toBe(true);
  });
  test("帳票の型で読むと：作業内容の行が日付・号炉・機器・作業の行になり、見出しの欄は機器にならない", async () => {
    const s = session([FORM]);
    await add(s, REPORT);
    // 機器の資料が無いので、機器の名前を新しい機器として入れるかを聞かれる（人が答える）
    for (const q of s.analyze().open.filter((x) => x.kind === "eventAsset" && x.options.some((o) => o.id === "new"))) s.settle([{ questionId: q.questionId, answer: "new", author: "human", reason: "試験：新しい機器" }]);
    const an = s.analyze();
    const evs = an.records.events;
    expect(evs.length).toBe(76);
    expect(an.records.assets.length).toBe(0);
    expect(an.composition.plan?.assets.some((a) => /日\s*付|天\s*候|作業責任者/u.test(a.name)) ?? false).toBe(false);
    const first = evs.find((e) => e.sheet === "6.5")!;
    expect(first).toMatchObject({ date: { y: 2025, m: 6, d: 5 }, assetNames: ["炉内清掃"], unit: { kind: "number", n: 1 }, manDays: 6 });
    // 作業の行が 2 つ以上の日は、その日の工数を行に割らない（理由を付けて外す）
    expect(evs.filter((e) => e.manDays !== null).length).toBeGreaterThan(0);
    expect(evs.filter((e) => e.manDays !== null).every((e) => evs.filter((x) => x.sheet === e.sheet).length === 1)).toBe(true);
    // 曜日が日付と合わない 1 枚（6.19「令和7年6月19日（水）」）だけは日付が読めず、問いに残る（推し量らない）
    expect(evs.filter((e) => !e.date).map((e) => e.sheet)).toEqual(["6.19"]);
    // 使わない欄は、どれも理由つきで外す（黙って捨てない）
    const status = an.composition.status;
    const reasons = new Set([...status.values()].flatMap((v) => (v.s === "excluded" ? [v.reason] : [])));
    expect([...reasons].some((x) => x.includes("帳票の欄（読み方のルール「daily-form」"))).toBe(true);
    expect([...status.values()].filter((v) => v.s === "unresolved").length).toBeLessThanOrEqual(4);
  });
});

describe("デモの発注台帳（財務会計の CSV）", () => {
  test("規則が無いと：「節名称」（委託料など）が機器の名前になる", async () => {
    const s = session([]);
    await add(s, LEDGER);
    expect(s.analyze().records.events.flatMap((e) => e.assetNames)).toContain("委託料");
  });
  test("契約の欄で読むと：2 つの塊の 20 行がどれも契約の記録になり、未解決のセルも問いも残らない", async () => {
    const s = session(LEDGER_RULES);
    await add(s, LEDGER);
    for (const q of s.analyze().open.filter((x) => x.kind === "costUnit")) s.settle([{ questionId: q.questionId, answer: "1", author: "human", reason: "試験：円" }]);
    const an = s.analyze();
    expect(an.records.events.length).toBe(0);
    expect(an.records.contracts.length).toBe(20);
    expect(an.records.contracts.find((c) => c.title?.includes("火格子補修工事"))).toMatchObject({ vendor: "【架空】さくら坂機工株式会社", fiscalYear: 2025 });
    expect([...an.composition.status.values()].filter((v) => v.s === "unresolved").length).toBe(0);
    expect(an.open.filter((q) => !q.decision).length).toBe(0);
  });
});
