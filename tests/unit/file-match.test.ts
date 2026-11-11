// 資料の名前を、名前の一部で引く（mushitaro/moyai#57）。Skill の文は増やさず、ツールの答え（種類ごとの名前の一覧）と引数（match）で解く。
// 115 本の資料（デモと同じ数）を作業画面に入れ、「発注台帳 R6」のような言い方から 1 回で引けること。
import { afterEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabToolAsync } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan } from "../../src/app/state/plan-store";
import { fileKinds, matchFiles, normName, shortName } from "../../src/shared/file-match";

afterEach(() => clearWorkingPlan());
const CTX = { conversation: "c-file-match", rowsRemaining: 2000 };

describe("名前の一部で引く", () => {
  const names = ["【架空】ほたる川CC_発注台帳_R5.xlsx", "【架空】ほたる川CC_発注台帳_R6.xlsx", "作業日報_2024.csv", "ＤＣＳ点検報告.pdf"];
  it("全角・半角・大文字小文字をそろえ、空白で区切った語がどれも入るものだけ", () => {
    expect(matchFiles("発注台帳 R6", names)).toEqual(["【架空】ほたる川CC_発注台帳_R6.xlsx"]);
    expect(matchFiles("発注台帳 ｒ６", names)).toEqual(["【架空】ほたる川CC_発注台帳_R6.xlsx"]);
    expect(matchFiles("発注台帳", names)).toHaveLength(2);
    expect(matchFiles("dcs", names)).toEqual(["ＤＣＳ点検報告.pdf"]);
    expect(matchFiles("  ", names)).toEqual([]);
    expect(normName("Ａ Ｂ")).toBe("ab");
  });
  it("長い名前は頭と尾だけ。種類ごとに数と最初の 3 本", () => {
    expect(shortName("あ".repeat(50) + ".xlsx").length).toBe(32);
    expect(shortName("短い.csv")).toBe("短い.csv");
    const k = fileKinds([...names, "b.xlsx", "c.xlsx"]);
    expect(k[0]).toEqual({ kind: ".xlsx", count: 4, names: names.slice(0, 2).concat("b.xlsx") });
    expect(k.map((x) => x.kind)).toEqual([".xlsx", ".csv", ".pdf"]);
  });
});

describe("intake_survey（115 本）", () => {
  const csv = (i: number) => new TextEncoder().encode(`設備,作業,日付\n【架空】ポンプ ${i},点検,2024-04-01\n`);
  async function world() {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】第一清掃工場", fiscalYearStartMonth: 4, fictional: true });
    const files = Array.from({ length: 113 }, (_, i) => ({ name: `作業日報_${String(i + 1).padStart(3, "0")}.csv`, size: 1, bytes: async () => csv(i) }));
    files.push({ name: "【架空】発注台帳_R5.csv", size: 1, bytes: async () => csv(900) }, { name: "【架空】発注台帳_R6.csv", size: 1, bytes: async () => csv(901) });
    await ws.addFiles(files);
    return ws;
  }

  it("要約（part を省く）に種類ごとの数と最初の名前。part: files と match で 1 回で引ける", async () => {
    const ws = await world();
    const all = await runTabToolAsync(ws, "intake_survey", { part: "all" }, CTX);
    if (!all.ok) throw new Error(all.code);
    expect(all.data.filesTotal).toBe(115);
    expect(all.data.fileKinds).toEqual([{ kind: ".csv", count: 115, names: ["作業日報_001.csv", "作業日報_002.csv", "作業日報_003.csv"] }]);
    const hit = await runTabToolAsync(ws, "intake_survey", { part: "files", match: "発注台帳 r6" }, CTX);
    if (!hit.ok) throw new Error(hit.code);
    expect(hit.data.filesMatched).toBe(1);
    expect((hit.data.files as { fileRef: string }[]).map((f) => f.fileRef)).toEqual(["【架空】発注台帳_R6.csv"]);
    const two = await runTabToolAsync(ws, "intake_survey", { part: "files", match: "発注台帳" }, CTX);
    if (!two.ok) throw new Error(two.code);
    expect(two.data.filesMatched).toBe(2);
  });

  it("読み方の規則の when.file は、名前の一部が 1 本に決まればその名前に、2 本以上なら候補を note に返す（置き換えない）", async () => {
    const ws = await world();
    const rule = (file: string) => ({ id: "r1", kind: "headerRow", text: "見出しは 1 行目として読む", when: { file }, row: 1, author: "ai", reason: "試し" });
    const one = await runTabToolAsync(ws, "reading_rules_propose", { name: "試し", scope: "facility", rules: [rule("発注台帳 R6")] }, CTX);
    if (!one.ok) throw new Error(one.code);
    expect(ws.draftReading("試し")?.skill.rules[0]?.when?.file).toBe("【架空】発注台帳_R6.csv");
    const many = await runTabToolAsync(ws, "reading_rules_propose", { name: "試し2", scope: "facility", rules: [rule("発注台帳")] }, CTX);
    if (!many.ok) throw new Error(many.code);
    expect(String(many.data.note)).toContain("「発注台帳」に当たる資料が 2 本");
    expect(ws.draftReading("試し2")?.skill.rules[0]?.when?.file).toBe("発注台帳");
  });
});
