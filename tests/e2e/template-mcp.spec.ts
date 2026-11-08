// 「この様式で Excel を出して」：AI が MCP で intake_add_files（source: template）を呼び、作業画面の EXPORT の様式の欄に入る。
// 想定のプロンプトの試験（11-08 の 2 回目）で、4 回とも時間切れになった道。運営者が OK した様式（若葉）があれば、それで確かめる。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { callTool as call, mcpClient as connect, openIntakeAndDrop, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const WAKABA = join(process.env.USERPROFILE ?? "", "Downloads", "【架空】若葉クリーンセンター_中長期整備計画書_入れ子縦結合・末尾集計.xlsx");

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-template-mcp-");
});
test.afterAll(() => bridge?.stop());

test("AI が様式を EXPORT の様式の欄に入れ、様式の形が答えに返る（時間切れにならない）", async ({ page }) => {
  test.skip(!existsSync(WAKABA), "運営者の様式がこの PC に無い");
  test.setTimeout(120_000);
  const c = await connect(bridge.stateDir, ["intake_add_files", "intake_survey"]);
  try {
    await openIntakeAndDrop(page, bridge.base, "【架空】様式の試験");
    const t0 = Date.now();
    const r = await call(c, "intake_add_files", { source: "template", path: WAKABA });
    const sec = (Date.now() - t0) / 1000;
    console.log(`template add: ${sec}s`, JSON.stringify(r).slice(0, 400));
    expect(r.added.map((a: { name: string }) => a.name)).toEqual([WAKABA.split(/[\\/]/).pop()]);
    expect(r.template).toBeTruthy();
    expect(sec).toBeLessThan(20);
  } finally {
    await c.close();
  }
});

const HOKUBU = join(process.env.USERPROFILE ?? "", "OneDrive", "Desktop", "Moyai_Sample", "【架空】北部CC");

test("北部CC の 9 本で計画を作ったあとでも、様式が時間切れにならずに入る", async ({ page }) => {
  test.skip(!existsSync(WAKABA) || !existsSync(HOKUBU), "運営者の資料がこの PC に無い");
  test.setTimeout(900_000);
  const c = await connect(bridge.stateDir, ["intake_add_files", "intake_survey", "intake_settle", "intake_compose"]);
  try {
    await page.goto(`${bridge.base}/`);
    await page.waitForTimeout(1500);
    const add = await call(c, "intake_add_files", { source: "folder", path: HOKUBU, pack: "waste-incineration", facilityName: "【架空】北部CC" });
    console.log("add", JSON.stringify(add).slice(0, 300));
    for (let round = 0; round < 25; round++) {
      const s = await call(c, "intake_survey", { part: "questions" });
      if (!s.questions?.length) break;
      const odd = s.questions.filter((q: any) => q.defaultAnswer == null && !q.options?.length && q.valueKind !== "number");
      if (odd.length) console.log("odd", JSON.stringify(odd.slice(0, 2)).slice(0, 500));
      const byId = new Map(s.questions.map((q: any) => [q.questionId, q]));
      const opts = (q: any): any[] => (q.options?.length ? q.options : q.sameOptionsAs ? opts(byId.get(q.sameOptionsAs) ?? {}) : []);
      const decisions = s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer ?? opts(q)[0]?.id ?? "8", author: "ai", reason: "試験" }));
      for (let i = 0; i < decisions.length; i += 50) await call(c, "intake_settle", { decisions: decisions.slice(i, i + 50) });
    }
    const started = await call(c, "intake_compose");
    console.log("compose", JSON.stringify(started).slice(0, 200));
    for (let i = 0; i < 120; i++) {
      const s = await call(c, "intake_survey", { part: "compose" });
      if (s.compose?.state && s.compose.state !== "running") { console.log("composed", JSON.stringify(s.compose).slice(0, 300)); break; }
      await page.waitForTimeout(2000);
    }
    const t0 = Date.now();
    const r = await call(c, "intake_add_files", { source: "template", path: WAKABA });
    const sec = (Date.now() - t0) / 1000;
    console.log(`template add with plan: ${sec}s`, JSON.stringify(r).slice(0, 300));
    expect(r.added?.length).toBe(1);
    expect(sec).toBeLessThan(20);
  } finally {
    await c.close();
  }
});
