// Skill を AI に渡す（docs/plan.md §2.18.3）：作業画面が選んでいる分だけ（1 段：基本操作、2 段：選んでいるパック、3 段：当てている読み方）。
// どの結果（取り込み・星取表・検査・当てはめ）にも目録（段・名前・版）だけを添え、本文は intake_survey（part: skills）で返す。版は本文の指紋。
// 3 段の SKILL.md は、規則から作り直しても、人が手で書いた「## 補い」を残す。
import { afterEach, describe, expect, test } from "vitest";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { activeSkills, packSkill } from "../../src/app/skills";
import { clearWorkingPlan } from "../../src/app/state/plan-store";
import { handWritten, READING_SCHEMA, skillMarkdown, type LoadedReading } from "../../src/import/reading";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { SKILL_CATALOG_TOOLS, TOOLS } from "../../src/shared/tools";

afterEach(() => clearWorkingPlan());
const CTX = { conversation: "c-skills", rowsRemaining: 2000 };
const reading: LoadedReading = {
  skill: { schema: READING_SCHEMA, name: "【架空】甲工場の読み方", scope: "facility", rules: [{ id: "d1", text: "「作業日」の列の日付は yyyymmdd", kind: "dateFormat", column: "作業日", format: "yyyymmdd", author: "ai", reason: "会話で決めた" }] },
  version: "v",
  path: null,
  approved: false,
  draft: true,
};

describe("Skill を AI に渡す", () => {
  test("1 段は基本操作（instructions と同じ文）、2 段は選んだパックの SKILL.md、3 段は当てている読み方。版は本文の指紋", () => {
    const s = activeSkills("waste-incineration", [reading]);
    expect(s.map((x) => [x.tier, x.name])).toEqual([
      [1, "moyai"],
      [2, "pack:waste-incineration"],
      [3, "【架空】甲工場の読み方（下書き）"],
    ]);
    for (const line of MCP_INSTRUCTIONS.split("\n")) expect(s[0]!.text).toContain(line);
    expect(s[1]!.text).toContain("ごみ焼却施設のSkillパック（2 段目の Skill）");
    expect(s[2]!.text).toContain("「作業日」の列の日付は yyyymmdd");
    expect(new Set(s.map((x) => x.version)).size).toBe(3);
    expect(activeSkills("waste-incineration", [reading])[1]!.version).toBe(s[1]!.version);
    // どのパックにも SKILL.md がある。パックを選んでいなければ 2 段は無い
    expect(packSkill("night-soil")).toContain("し尿処理施設のSkillパック");
    expect(activeSkills(null, []).map((x) => x.tier)).toEqual([1]);
  });

  test("intake_survey の結果に目録だけを添え、part: skills で本文を返す", () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】甲", fiscalYearStartMonth: 4, fictional: true });
    const all = runTabTool(ws, "intake_survey", {}, CTX);
    if (!all.ok) throw new Error(all.code);
    expect((all.data.skills as { tier: number; name: string }[]).map((x) => [x.tier, x.name])).toEqual([
      [1, "moyai"],
      [2, "pack:waste-incineration"],
    ]);
    expect(all.data.skillTexts).toBeUndefined();
    expect(JSON.stringify(all.data)).not.toContain("ごみ焼却施設のSkillパック（2 段目の Skill）");
    const sk = runTabTool(ws, "intake_survey", { part: "skills" }, CTX);
    if (!sk.ok) throw new Error(sk.code);
    const texts = sk.data.skillTexts as { tier: number; text: string; version: string }[];
    expect(texts.map((x) => x.tier)).toEqual([1, 2]);
    expect(texts[1]!.text).toContain("ごみ焼却施設のSkillパック（2 段目の Skill）");
    expect(texts.map((x) => x.version)).toEqual((all.data.skills as { version: string }[]).map((x) => x.version));
    expect(TOOLS.intake_survey.output.safeParse(sk.data).success).toBe(true);
  });

  test("目録を添えるのは 4 つのツールで、その型は目録を受ける。説明に読み直しの決まりがある", () => {
    expect([...SKILL_CATALOG_TOOLS]).toEqual(["intake_survey", "chart_rows", "check_results", "crosswalk_propose"]);
    for (const n of SKILL_CATALOG_TOOLS) expect(Object.keys(TOOLS[n].output.shape), n).toContain("skills");
    expect(TOOLS.intake_survey.description).toContain("part: skills");
  });

  test("3 段の SKILL.md：規則から作り直しても、人が手で書いた「## 補い」は残る", () => {
    const md = skillMarkdown(reading.skill);
    expect(handWritten(md)).toBeNull();
    const edited = `${md}\n## 補い\n\n- 「炉」の列の 1 と 2 は号炉の番号。\n`;
    const hand = handWritten(edited);
    expect(hand).toContain("号炉の番号");
    const again = skillMarkdown({ ...reading.skill, rules: [...reading.skill.rules, { ...reading.skill.rules[0]!, id: "d2", text: "「炉」の列を号炉として読む" }] }, hand);
    expect(again).toContain("「炉」の列を号炉として読む");
    expect(again).toContain("号炉の番号");
  });
});
