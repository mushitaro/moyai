// 資料の多い作業画面に、Claude が会話で加工したファイルを intake_add_files で足すあいだ、画面が空にならないか（mushitaro/moyai#47 の再現）。
// 115 個の資料を MCP で入れ（デモと同じ数）、読み終えてから、加工したファイル 1 つを同じフォルダに置き、フォルダごと入れ直す。足しているあいだ 100ms ごとに、
// 資料の選び（source-picker）が見えているかを数える。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { callTool as call, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let dir = "";
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-ai-added-");
  dir = mkdtempSync(join(tmpdir(), "moyai-e2e-ai-added-files-"));
});
test.afterAll(() => {
  bridge?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const csv = (i: number) => `設備,作業,日付\n【架空】ポンプ ${i},点検,2024-04-${String((i % 28) + 1).padStart(2, "0")}\n`;

test("115 個の資料のあとに、加工したファイルを足しても、資料の選びは消えない", async ({ page }, info) => {
  test.setTimeout(180_000);
  const many = join(dir, "many");
  mkdirSync(many);
  for (let i = 1; i <= 115; i++) writeFileSync(join(many, `daily-${String(i).padStart(3, "0")}.csv`), csv(i));

  await page.goto(`${bridge.base}/#/merge`);
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
  const c = await mcpClient(bridge.stateDir, ["intake_add_files"]);
  try {
    const first = await call(c, "intake_add_files", { source: "folder", path: many, facilityName: "【架空】第一清掃工場", pack: "waste-incineration" });
    expect(first.added.length + (first.late ? 0 : 0)).toBeGreaterThan(0);
    await expect(page.getByTestId("source-picker")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "115", { timeout: 60_000 });
    await page.screenshot({ path: shot(`ai-added-before-${info.project.name}`) });

    let seen = 0;
    let gone = 0;
    let watching = true;
    const watch = (async () => {
      while (watching) {
        if (await page.getByTestId("source-picker").isVisible()) seen++;
        else gone++;
        await page.waitForTimeout(100);
      }
    })();
    // 同じフォルダに加工したファイルを置き、フォルダごと入れ直す（Claude がこうすることがある）
    writeFileSync(join(many, "daily-001_加工.csv"), csv(1));
    const second = await call(c, "intake_add_files", { source: "folder", path: many });
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "116", { timeout: 60_000 });
    watching = false;
    await watch;
    expect(gone).toBe(0);
    expect(seen).toBeGreaterThan(0);
    // 足したのは加工したファイル 1 つだけ。前の 115 個は取りに行かず、同じ名前として返す。資料の選びは足した資料に移る
    expect(second.added.map((a: { name: string }) => a.name)).toEqual(["daily-001_加工.csv"]);
    expect(second.refused.filter((r: { reason: string }) => r.reason === "same_name")).toHaveLength(115);
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-file", "daily-001_加工.csv");
    await page.screenshot({ path: shot(`ai-added-after-${info.project.name}`) });
  } finally {
    await c.close();
  }
});
