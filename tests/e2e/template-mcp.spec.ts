// 「この様式で Excel を出して」：AI が MCP で intake_add_files（source: template）を呼び、作業画面の EXPORT の様式の欄に入る。
// 想定のプロンプトの試験（11-08 の 2 回目）で、4 回とも時間切れになった道。運営者が OK した様式（若葉）があれば、それで確かめる。
// 運営者の資料がこの PC にあれば、それで確かめる。無い PC（CI など）では、同じ形の架空の資料で同じ道を通す（どちらも架空。合格の条件は同じ）：
//   様式：入れ子の縦の結合と末尾の集計のある中長期整備計画書（xlsx-cli で作る）
//   資料：fictional-1 の 9 本（台帳・星取表・日報と、6 年分の報告書）。既定の答えで計画まで作れるので、代わりの資料のときは計画ができたことも確かめる
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { callTool as call, mcpClient as connect, openIntakeAndDrop, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const OPERATOR_WAKABA = join(process.env.USERPROFILE ?? "", "Downloads", "【架空】若葉クリーンセンター_中長期整備計画書_入れ子縦結合・末尾集計.xlsx");
const OPERATOR_HOKUBU = join(process.env.USERPROFILE ?? "", "OneDrive", "Desktop", "Moyai_Sample", "【架空】北部CC");
const F1 = "samples/out/waste-incineration/fictional-1";
const NINE = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv", ...[2019, 2020, 2021, 2022, 2023, 2024].map((y) => `reports/report-f1-fy${y}.xlsx`)];

let bridge: StartedBridge;
let work = "";
let WAKABA = "";
let HOKUBU = "";
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-template-mcp-");
  // 橋渡しはリポジトリの中のフォルダを読まないので、写すものはリポジトリの外の一時のフォルダに置く
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-template-mcp-"));
  WAKABA = existsSync(OPERATOR_WAKABA) ? OPERATOR_WAKABA : fictionalTemplate(join(work, "【架空】中長期整備計画書_入れ子縦結合・末尾集計.xlsx"));
  HOKUBU = existsSync(OPERATOR_HOKUBU) ? OPERATOR_HOKUBU : nineFiles(join(work, "【架空】第一清掃工場"));
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** 入れ子の縦の結合（設備 › 機器）と、末尾の集計の行（式）のある架空の様式 */
function fictionalTemplate(path: string): string {
  const cells: Record<string, string | number> = { A1: "【架空】中長期整備計画書", A3: "設備", B3: "機器", C3: "作業", D3: "R8", E3: "R9", F3: "R10", G3: "R11", H3: "R12" };
  const rows = [
    ["受入供給設備", "計量機", "点検"],
    ["", "", "整備"],
    ["", "ごみクレーン", "点検"],
    ["", "", "整備"],
    ["燃焼設備", "ストーカ", "点検"],
    ["", "", "整備"],
  ];
  rows.forEach((r, i) => r.forEach((v, j) => v && (cells[`${String.fromCharCode(65 + j)}${4 + i}`] = v)));
  cells.A10 = "合計";
  for (const c of ["D", "E", "F", "G", "H"]) cells[`${c}10`] = `=SUM(${c}4:${c}9)`;
  const merges = ["A4:A7", "B4:B5", "B6:B7", "A8:A9", "B8:B9", "A10:C10"];
  const r = spawnSync(process.execPath, ["tests/helpers/xlsx-cli.mjs", "write", path, JSON.stringify({ sheet: "計画", cells, merges })], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return path;
}

/** 架空の施設（fictional-1）の 9 本を一時のフォルダの直下に写す */
function nineFiles(dir: string): string {
  mkdirSync(dir, { recursive: true });
  for (const n of NINE) copyFileSync(join(F1, n), join(dir, basename(n)));
  expect(readdirSync(dir)).toHaveLength(9);
  return dir;
}

test("AI が様式を EXPORT の様式の欄に入れ、様式の形が答えに返る（時間切れにならない）", async ({ page }) => {
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

test("北部CC の 9 本で計画を作ったあとでも、様式が時間切れにならずに入る", async ({ page }) => {
  test.setTimeout(900_000);
  const c = await connect(bridge.stateDir, ["intake_add_files", "intake_survey", "intake_settle", "intake_compose"]);
  try {
    await page.goto(`${bridge.base}/`);
    await page.waitForTimeout(1500);
    const add = await call(c, "intake_add_files", { source: "folder", path: HOKUBU, pack: "waste-incineration", facilityName: HOKUBU === OPERATOR_HOKUBU ? "【架空】北部CC" : "【架空】第一清掃工場" });
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
      if (s.compose?.state && s.compose.state !== "running") {
        console.log("composed", JSON.stringify(s.compose).slice(0, 300));
        // 代わりの資料では、計画ができたあとであることも確かめる（運営者の資料での結果は、その PC で見る）
        if (HOKUBU !== OPERATOR_HOKUBU) expect(s.compose.state, JSON.stringify(s.compose).slice(0, 300)).toBe("done");
        break;
      }
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
