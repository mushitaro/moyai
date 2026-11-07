// 資料 9 つ（日報は 12 シート）を落とした HOSHITORI の資料のシートを、この PC の Chrome と Edge で開く（docs/screens.md 3.2「資料の選び」、Wire、11-07）。
// 運営者の 11-07 の写し（資料ごとのタブが横に並びきらず、本体が左に切れ、横の板が画面の中ほどに浮き、ページが横にずれた）と同じ数の資料で撮り直す：
// タブの行は 1 行（「資料」の札・資料の選び・シートの選び・「＋ 資料を追加」）、ページは横に送らない、横の板は右端に 320px。
// 資料の一覧を開いた所と閉じた所の写しを撮る。一覧は名前で絞り、↑↓・Enter・Esc で動かす。
// 資料はすべて架空：工場の fictional-1 の資料 8 つと、その作業日報の行を試験の中で 12 シート（4月〜3月）に組み直した daily-report.xlsx。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FICTIONAL_1, packName, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const MONTHS = ["4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月"];
const REPORTS = [2019, 2020, 2021, 2022, 2023, 2024].map((y) => `report-f1-fy${y}.xlsx`);

/**
 * fictional-1 の作業日報（Shift_JIS の CSV）の行を、12 シートの xlsx に組み直す（1 シート 20 行）。
 * Excel を作るのは別のプロセス（tests/helpers/xlsx-cli.mjs。exceljs を Playwright の中で読み込まないため）。一時のフォルダに書いて読み、消す
 */
function dailyBook(): Buffer {
  const lines = new TextDecoder("shift_jis")
    .decode(readFileSync(join(FICTIONAL_1.dir, "daily-report.csv")))
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const at = lines.findIndex((l) => l.startsWith("日付,"));
  const head = lines[at]!.split(",");
  const rows = lines.slice(at + 1).map((l) => l.split(","));
  const sheets = MONTHS.map((name, i) => ({ name, rows: [head, ...rows.slice(i * 20, i * 20 + 20)] }));
  const dir = mkdtempSync(join(tmpdir(), "moyai-e2e-many-files-book-"));
  try {
    const path = join(dir, "daily-report.xlsx");
    const r = spawnSync(process.execPath, ["tests/helpers/xlsx-cli.mjs", "book", path], { input: JSON.stringify({ sheets }), encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return readFileSync(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function dropNine(page: Page, base: string): Promise<string[]> {
  await page.goto(`${base}/#/intake`);
  await expect(page.getByTestId("intake-page")).toBeVisible();
  await page.getByTestId("pack").click();
  await page.getByRole("option", { name: packName("waste-incineration"), exact: true }).click();
  await page.getByTestId("facility-name").fill("【架空】資料 9 つの工場");
  const files = [
    { name: "daily-report.xlsx", b64: dailyBook().toString("base64") },
    ...["equipment-ledger.xlsx", "plan-hoshitori.xlsx"].map((n) => ({ name: n, b64: readFileSync(join(FICTIONAL_1.dir, n)).toString("base64") })),
    ...REPORTS.map((n) => ({ name: n, b64: readFileSync(join(FICTIONAL_1.dir, "reports", n)).toString("base64") })),
  ];
  expect(files).toHaveLength(9);
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    return d;
  }, files);
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
  return files.map((f) => f.name);
}

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-many-files-");
});
test.afterAll(() => bridge?.stop());

test("資料 9 つ（日報は 12 シート）：タブの行は 1 行、ページは横に送らない。資料の一覧を開いた所と閉じた所", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const names = await test.step("資料 9 つを落とす", async () => {
    const n = await dropNine(page, bridge.base);
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "9", { timeout: 90_000 });
    await expect(page.getByTestId("source-reading")).toHaveCount(0, { timeout: 30_000 });
    return n;
  });

  await test.step("閉じた所：タブの行は 1 行で、資料ごとのタブは無い。日報を開くとシートの選び「4月 ▾　1 / 12」。ページは横に送らない", async () => {
    await expect(page.getByTestId("sheet-file")).toHaveCount(0);
    // 第 1 版の前に開いた資料（未確定のいちばん多い資料）
    const opened = (await page.getByTestId("source-picker").getAttribute("data-file")) ?? "";
    expect(names).toContain(opened);
    await expect(page.getByTestId("source-position")).toHaveText(/^\d \/ 9$/);
    // 日報を開く
    await page.getByTestId("source-picker").click();
    await page.locator('[data-testid="source-row"][data-file="daily-report.xlsx"]').click();
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-file", "daily-report.xlsx");
    await expect(page.getByTestId("source-position")).toHaveText("1 / 9");
    await expect(page.getByTestId("sheet-picker")).toContainText("4月");
    await expect(page.getByTestId("sheet-position")).toHaveText("1 / 12");
    await expect(page.locator('[data-testid="source-tab"][data-file="daily-report.xlsx"]')).toHaveAttribute("data-sheet", "4月");
    // シートの選び：一覧で 3 つ下へ動かして Enter
    await page.getByTestId("sheet-picker").click();
    await expect(page.getByTestId("sheet-row")).toHaveCount(12);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("sheet-position")).toHaveText("4 / 12");
    await expect(page.locator('[data-testid="source-tab"][data-file="daily-report.xlsx"]')).toHaveAttribute("data-sheet", "7月");
    // タブの行は 1 行（行の高さはタブ 1 つ分）
    const tabs = await page.getByTestId("merge-tabs").boundingBox();
    expect(tabs).toBeTruthy();
    expect(tabs!.height).toBeLessThan(36 * 2);
    // ページは横に送らない：画面の幅より広いものが無い
    const widths = await page.evaluate(() => {
      const main = document.querySelector(".moyai-main") as HTMLElement | null;
      return { doc: document.documentElement.scrollWidth, view: window.innerWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
    });
    expect(widths.doc).toBeLessThanOrEqual(widths.view);
    expect(widths.main).toBeLessThanOrEqual(0);
    // 横の板は右端に 320px（開いていれば。既定はたたむ）
    if (await page.getByTestId("merge-side").isVisible()) {
      const side = await page.getByTestId("merge-side").boundingBox();
      expect(Math.round(side!.width)).toBe(320);
      // 右端（縦の送りの幅のぶんだけ内側になることはある。中ほどに浮かない）
      expect(Math.abs(side!.x + side!.width - widths.view)).toBeLessThanOrEqual(20);
    }
    await page.screenshot({ path: shot(`many-files-closed-${tag}`) });
  });

  await test.step("開いた所：幅 520px の一覧、名前で絞る欄に字が入る。行「名前｜シート n｜未確定 n｜状態」", async () => {
    await page.getByTestId("source-picker").click();
    const list = page.getByTestId("source-list");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("source-filter-name")).toBeFocused();
    await expect(page.getByTestId("source-filter-name")).toHaveAttribute("placeholder", "名前");
    await expect(page.getByTestId("source-row")).toHaveCount(9);
    await expect(page.locator('[data-testid="source-row"][data-file="daily-report.xlsx"]')).toContainText("シート 12");
    await expect(page.locator('[data-testid="source-row"][data-file="daily-report.xlsx"]')).toHaveAttribute("data-current", "true");
    const box = await page.locator(".moyai-srcpick-dropdown").boundingBox();
    expect(Math.round(box!.width)).toBe(520);
    // 一覧は画面の中に収まる（ページを横に送らない）
    expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    await page.screenshot({ path: shot(`many-files-open-${tag}`) });
  });

  await test.step("キー操作：名前で絞り、↓ と Enter で開く。Esc で閉じる。未確定の多い順", async () => {
    await page.getByTestId("source-filter-name").fill("fy20");
    await expect(page.getByTestId("source-row")).toHaveCount(6);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("source-list")).toHaveCount(0);
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-file", "report-f1-fy2020.xlsx");
    await expect(page.locator('[data-testid="source-tab"][data-file="report-f1-fy2020.xlsx"]')).toBeVisible();
    // シートが 1 つの資料ではシートの選びを出さない
    await expect(page.getByTestId("sheet-picker")).toHaveCount(0);
    // Esc で閉じ、選びに戻る
    await page.getByTestId("source-picker").click();
    await expect(page.getByTestId("source-list")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("source-list")).toHaveCount(0);
    await expect(page.getByTestId("source-picker")).toBeFocused();
    // 未確定の多い順：先頭の行の未確定がいちばん多い
    await page.getByTestId("source-picker").click();
    await page.getByTestId("source-order").getByRole("button", { name: "未確定の多い順" }).click();
    const opens = (await page.getByTestId("source-row").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-open") ?? "-1")))) as number[];
    expect(opens).toHaveLength(9);
    expect(opens[0]).toBe(Math.max(...opens));
    await page.keyboard.press("Escape");
    // ‹ › で前後の資料（端では押せないので、押せる方）
    const before = await page.getByTestId("source-position").textContent();
    const next = page.getByTestId("source-next");
    await ((await next.isDisabled()) ? page.getByTestId("source-prev") : next).click();
    await expect(page.getByTestId("source-position")).not.toHaveText(before ?? "");
  });
});
