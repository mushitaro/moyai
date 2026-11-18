// 資料を消す（運営者 2026-11-18「デモで別の資料に入れ替えようとしたが、チャットからも画面からも資料が消せなかった」）。
// 画面：資料の選びの一覧の行の右端の「消す」→ 同じ所が「消す？」→ もう一度押すと消える（Wire の SourceRemove）。
// チャット：intake_remove_files は apply なしで消さずに数だけを返し、apply: true で消す。知らない名前は、どれも消さずに断る。
// 資料は一時のフォルダに作る架空の CSV（デモの資料の中身によらない）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { callTool as call, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let dir = "";
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-remove-");
  dir = mkdtempSync(join(tmpdir(), "moyai-e2e-remove-files-"));
});
test.afterAll(() => {
  bridge?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const csv = (i: number) => `設備,作業,日付\n【架空】ポンプ ${i},点検,2024-04-${String((i % 28) + 1).padStart(2, "0")}\n`;

test("画面の「消す」とチャットの intake_remove_files で、作業画面の資料を 1 つずつ消せる", async ({ page }, info) => {
  test.setTimeout(120_000);
  const folder = join(dir, "files");
  mkdirSync(folder);
  for (let i = 1; i <= 4; i++) writeFileSync(join(folder, `daily-${i}.csv`), csv(i));

  await page.goto(`${bridge.base}/#/merge`);
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
  const c = await mcpClient(bridge.stateDir, ["intake_add_files", "intake_remove_files"]);
  try {
    const added = await call(c, "intake_add_files", { source: "folder", path: folder, facilityName: "【架空】消す工場", pack: "waste-incineration" });
    expect(added.added).toHaveLength(4);
    const picker = page.getByTestId("source-picker");
    await expect(picker).toHaveAttribute("data-count", "4", { timeout: 60_000 });

    await test.step("画面：一覧の行の「消す」→「消す？」→ もう一度押すと消える", async () => {
      await picker.click();
      const row = page.locator('[data-testid="source-row"][data-file="daily-2.csv"]');
      const remove = row.getByTestId("source-remove");
      await expect(remove).toHaveText("消す");
      await remove.click();
      // 1 回目では消えない（同じ所が「消す？」になる）
      await expect(remove).toHaveText("消す？");
      await expect(remove).toHaveAttribute("data-asking", "true");
      await expect(picker).toHaveAttribute("data-count", "4");
      await page.screenshot({ path: shot(`remove-files-ask-${info.project.name}`) });
      await remove.click();
      await expect(picker).toHaveAttribute("data-count", "3", { timeout: 30_000 });
      await expect(page.locator('[data-testid="source-row"][data-file="daily-2.csv"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      const s = await call(c, "intake_survey", { part: "files" });
      expect(s.files.map((f: { fileRef: string }) => f.fileRef).sort()).toEqual(["daily-1.csv", "daily-3.csv", "daily-4.csv"]);
    });

    await test.step("チャット：apply なしは消さずに数だけ、apply: true で消す", async () => {
      const p = await call(c, "intake_remove_files", { files: ["daily-3.csv"] });
      expect(p).toMatchObject({ applied: false, removed: [], files: ["daily-3.csv"], unknown: [], refused: null, filesLeft: 3 });
      await expect(picker).toHaveAttribute("data-count", "3");
      const a = await call(c, "intake_remove_files", { files: ["daily-3.csv"], apply: true });
      expect(a).toMatchObject({ applied: true, removed: ["daily-3.csv"], refused: null, filesLeft: 2 });
      await expect(picker).toHaveAttribute("data-count", "2", { timeout: 30_000 });
      // 結果に資料の中身（セルの値）は入らない
      expect(JSON.stringify(a)).not.toContain("ポンプ");
    });

    await test.step("チャット：作業画面に無い名前は、どれも消さずに断る", async () => {
      const r = await call(c, "intake_remove_files", { files: ["daily-1.csv", "nai.csv"], apply: true });
      expect(r).toMatchObject({ applied: false, removed: [], unknown: ["nai.csv"], refused: "unknown", filesLeft: 2 });
      await expect(picker).toHaveAttribute("data-count", "2");
    });

    await test.step("消した資料はディスクから消えず、入れ直せる", async () => {
      const again = await call(c, "intake_add_files", { source: "folder", path: folder, match: "daily-2" });
      expect(again.added.map((x: { name: string }) => x.name)).toEqual(["daily-2.csv"]);
      await expect(picker).toHaveAttribute("data-count", "3", { timeout: 30_000 });
    });
    await page.screenshot({ path: shot(`remove-files-after-${info.project.name}`) });
  } finally {
    await c.close();
  }
});
