// AI の経路（reading_rules_propose）から置く読み方の規則は、作者を AI に固め、決めた人の呼び名を捨てる（人と名乗らせない。台帳の新-8）
import { expect, test } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";

test("AI が作者を人と書いても、下書きの規則の作者は AI で、呼び名は残らない", () => {
  const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】作者の試験", fiscalYearStartMonth: 4, fictional: true });
  const rule = { id: "r1", text: "「作業日」の列の日付は yyyymmdd として読む", kind: "dateFormat", column: "作業日", format: "yyyymmdd", author: "human", by: "【架空】課長", reason: "会話で決めた" };
  const r = runTabTool(ws, "reading_rules_propose", { name: "【架空】日報の読み方", scope: "facility", rules: [rule] }, { conversation: "c", rowsRemaining: 2000 });
  expect(r.ok).toBe(true);
  const d = ws.draftReading("【架空】日報の読み方");
  expect(d?.skill.rules).toHaveLength(1);
  expect(d?.skill.rules[0]).toMatchObject({ author: "ai" });
  expect("by" in d!.skill.rules[0]!).toBe(false);
});
