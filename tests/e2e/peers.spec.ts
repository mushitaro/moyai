// 受け手の側を、この PC の Chrome と Edge で通す（docs/plan.md §2.8 受け取りと 3 つの立場）：
// 設定で公開の台帳の clone の場所を選ぶ → 星取表の共通の設備項目の行で［似た施設と並べる］→ 施設の設定で見え方を答える → 台帳の ✓ の束から似た施設の行
// → AI は本物の中継（dist/cli.js mcp）の peer_reference で、人が開いた比べの集計と札だけを読む → 立場を O&M にすると入札の対象の見え方を聞く
// → 閉じると行が消え、AI も読めない。台帳は架空の 10 施設（scripts/ledger/demo-core.ts。本物の署名と写し取りのコード）を一時のフォルダに作る。
// 先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { callTool, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let work = "";
let repo = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-peers-"));
  repo = join(work, "台帳の clone");
  buildLedgerDemo({ repo: process.cwd(), out: repo, state: join(work, "demo-state"), month: "2026-11" });
  bridge = await startBuiltBridge("moyai-e2e-peers-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function openCommonRows(page: Page) {
  const body = JSON.stringify(DEV_PLANS["fictional-1"]());
  await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  await page.goto(`${bridge.base}/?plan=fictional-1#/chart`);
  await expect(page.getByTestId("chart-page")).toBeVisible();
  await expect(page.locator(".ag-row").first()).toBeVisible();
  await page.getByTestId("rows-mode").getByRole("button", { name: "共通の設備項目 × 作業の属性" }).click();
  await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
}

test("台帳の clone から似た施設を並べ、AI は人が開いた比べだけを読む", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(120_000);
  const c = await mcpClient(bridge.stateDir, ["peer_reference"]);
  try {
    await test.step("設定で公開の台帳の clone の場所を選ぶ（相対の道は断る）", async () => {
      await page.goto(`${bridge.base}/#/settings`);
      await expect(page.getByTestId("current-ledger")).toHaveText("選んでいません");
      await page.getByTestId("ledger-input").fill("相対の道");
      await page.getByTestId("settings-save").click();
      await expect(page.getByText("公開の台帳の clone の場所は、ドライブから始まる絶対の道")).toBeVisible();
      await page.getByTestId("ledger-input").fill(repo);
      await page.getByTestId("settings-save").click();
      await expect(page.getByTestId("current-ledger")).toHaveText(repo);
    });

    await test.step("開く前は、AI は比べを読めない", async () => {
      const r: any = await c.callTool({ name: "peer_reference", arguments: {} });
      // 作業画面のタブがまだ無いか、人が比べを開いていないか（どちらも誤りとして返る）
      expect(r.isError).toBe(true);
    });

    await test.step("星取表の共通の設備項目の行で、似た施設と並べる", async () => {
      await openCommonRows(page);
      expect(await c.callTool({ name: "peer_reference", arguments: {} })).toMatchObject({ isError: true });
      // MERGE の見出しの「似た施設　重ねる / 外す」（既定は外す）
      await page.getByTestId("merge-peers").getByRole("button", { name: "重ねる" }).click();
      const panel = page.getByTestId("peer-panel");
      await expect(panel).toBeVisible();
      // 試しの計画は全国の表に載るかが決まっていない：推測で埋めず、「見え方が決まっていません　| 施設の設定で決める」
      await expect(page.getByTestId("peer-reason")).toHaveAttribute("data-reason", "groupUnknown");
      await expect(page.getByTestId("peer-reason")).toContainText("似た施設　見え方が決まっていません");
      // 見え方の答えは施設の設定の 1 か所だけ（星取表の上では答えない。比べるのに使う軸の印も無い）
      await expect(page.locator('[data-testid^="peer-self-"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="axis-"]')).toHaveCount(0);
      await page.getByTestId("peer-fix").click();
      await expect(page.getByTestId("facility-national")).toBeVisible();
      await page.getByTestId("facility-national").selectOption("yes");
      await page.getByTestId("facility-furnace").selectOption("STOKER");
      await page.getByTestId("facility-capacity_t_per_day").selectOption("C200_400");
      // 全国の表に列の無い軸（集じん）は聞かない
      await expect(page.getByTestId("facility-dust")).toHaveCount(0);
      await page.getByTestId("facility-save").click();
      await expect(page.getByTestId("facility-national")).toHaveCount(0);
      const ledger = page.locator('[data-testid="peer-place"][data-kind="ledger"]');
      await expect(ledger).toHaveAttribute("data-status", "shown");
      // 1 行：「公開の台帳　似た施設 n　| 見え方を直す」。台帳の 16 桁の ID は出さない
      await expect(ledger).toHaveText(/^公開の台帳　似た施設 \d+/);
      await expect(page.getByTestId("peer-places")).not.toContainText(/[0-9a-f]{16}/);
      await expect(page.getByTestId("peer-fix")).toHaveText("見え方を直す");
    });

    await test.step("自分の行の下に、似た施設を 1 行にまとめた細い行（名前は間隔の帯か「5 施設に満たない」）", async () => {
      // 似た施設ごとの行と帯の列は出さない（docs/screens.md 3.2）。印は、似た施設のどれかが作業をした年度
      await expect(page.locator(".ag-row.moyai-row-stat").first()).toBeVisible();
      await expect(page.locator(".ag-row.moyai-row-peer")).toHaveCount(0);
      await expect(page.locator(".ag-header-cell.moyai-band-head")).toHaveCount(0);
      const label = page.locator(".ag-row.moyai-row-stat .moyai-lv").filter({ hasText: "似た施設" }).first();
      await expect(label).toHaveText(/^似た施設　(帯 .+|5 施設に満たない)$/);
      await expect(page.locator(".ag-header-cell", { hasText: /\d{4} 年度/ }).first()).toBeInViewport();
      await label.click();
      await expect(page.getByTestId("peer-side")).toHaveAttribute("data-kind", "stat");
      await expect(page.getByTestId("peer-side")).toContainText("公開の台帳");
      await page.screenshot({ path: shot(`peers-${tag}-ledger`), fullPage: false });
    });

    await test.step("AI は peer_reference で、場ごとの集計と匿名の札だけを読む", async () => {
      const d = await callTool(c, "peer_reference");
      expect(d.position).toBe("municipal");
      expect(d.places[0]).toMatchObject({ place: "ledger", status: "shown" });
      expect(d.aggregates.length).toBeGreaterThan(0);
      expect(d.aggregates.every((a: { place: string }) => a.place === "ledger")).toBe(true);
      const text = JSON.stringify(d);
      // 台帳 ID・年度・見え方の値は返さない
      expect(text).not.toMatch(/FY20\d\d/);
      expect(text).not.toContain("STOKER");
    });

    await test.step("O&M にすると、入札の対象の見え方を聞く。選ぶと台帳と輪の順に並ぶ", async () => {
      await page.getByTestId("peer-position").getByRole("button", { name: "O&M 事業者" }).click();
      await expect(page.getByTestId("peer-reason")).toHaveAttribute("data-reason", "targetMissing");
      await expect(page.locator(".ag-row.moyai-row-peer")).toHaveCount(0);
      await page.getByTestId("peer-target-national").selectOption("yes");
      await page.getByTestId("peer-target-furnace").selectOption("STOKER");
      const places = page.getByTestId("peer-place");
      await expect(places).toHaveCount(2);
      await expect(places.nth(0)).toHaveAttribute("data-kind", "ledger");
      await expect(places.nth(1)).toHaveAttribute("data-kind", "ring");
      await expect(places.nth(1)).toHaveAttribute("data-status", "missing");
      await expect(places.nth(1)).toContainText("このパックの輪に入っていません");
      expect((await callTool(c, "peer_reference")).position).toBe("om");
      await page.screenshot({ path: shot(`peers-${tag}-om`), fullPage: false });
    });

    await test.step("外すと行が消え、AI も読めない", async () => {
      await page.getByTestId("merge-peers").getByRole("button", { name: "外す" }).click();
      await expect(page.getByTestId("peer-panel")).toHaveCount(0);
      await expect(page.locator(".ag-row.moyai-row-stat")).toHaveCount(0);
      const r: any = await c.callTool({ name: "peer_reference", arguments: {} });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain("似た施設との比べを、利用者がまだ星取表の画面で開いていません");
    });
  } finally {
    await c.close();
  }
});
