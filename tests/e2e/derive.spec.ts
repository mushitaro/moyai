// 派生（docs/screens.md 3.1、P2 の 3）を、この PC の Chrome と Edge で通す：
// 見本の計画を第 1 版として署名 → トップで版の印を押し、メニューの「この版から別の施設をつくる」→ 新しい施設の名前を決めて MERGE へ
// → 決定を受けて新しい施設の第 1 版に署名 → 版の記録に元（計画・版・中身のハッシュ）が残り、トップでは元の施設の下に字下げし、線でつなぐ。
// AI は使わない。先に npm run build を走らせておく。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";


let bridge: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-derive-"));
  bridge = await startBuiltBridge("moyai-e2e-derive-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("トップの版の印から別の施設をつくり、第 1 版に元を残して、元の施設の下に線でつなぐ", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");

  await test.step("人：設定。見本の計画を第 1 版として署名する", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("root-input").fill(root);
    await page.getByTestId("name-input").fill(E2E_NAME);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("current-name")).toHaveText(E2E_NAME);
    const body = JSON.stringify(DEV_PLANS["fictional-1"]());
    await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
    await expect(page.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("confirm-reason").fill("元の施設の第 1 版（e2e）");
    await signInDialog(page);
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    await page.keyboard.press("Escape");
  });

  const source = readdirSync(join(root, "plans"))[0]!;
  await test.step("トップ：版の印を押すとメニュー。「この版から別の施設をつくる」で名前を決めて MERGE へ", async () => {
    await page.goto(`${bridge.base}/#/`);
    await page.getByTestId("moyai-mark").first().click();
    await expect(page.getByTestId("moyai-mark-menu")).toContainText("第 1 版");
    await expect(page.getByTestId("mark-open")).toBeVisible();
    await expect(page.getByTestId("mark-next")).toBeVisible();
    await page.screenshot({ path: shot(`derive-menu-${tag}`) });
    await page.getByTestId("mark-derive").click();
    await expect(page.getByTestId("derive-submit")).toBeDisabled();
    await page.getByTestId("derive-name").fill("派生した清掃工場");
    await page.getByTestId("derive-submit").click();
    // 架空の施設から作ったので、名前に【架空】が付く。保管先にはまだ版が無いので、見出しは第 1 版
    await expect(page.getByTestId("plan-name")).toHaveText("【架空】派生した清掃工場");
    await expect(page.getByTestId("merge-version")).toHaveText("第 1 版");
    await expect(page.locator(".ag-row").first()).toBeVisible();
  });

  await test.step("新しい施設の第 1 版に署名すると、版の記録に元の計画・版・中身のハッシュが残る", async () => {
    await acceptDecisions(page, "試験の台本が押した（写した決定を受けた）");
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("confirm-reason").fill("元の施設の第 1 版から作った（e2e）");
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    await page.keyboard.press("Escape");
    const plans = readdirSync(join(root, "plans")).sort();
    expect(plans).toHaveLength(2);
    const derived = plans.find((p) => p !== source)!;
    const rec = JSON.parse(readFileSync(join(root, "plans", derived, "versions", "000001.json"), "utf8"));
    expect(rec.derivedFrom).toMatchObject({ planId: source, version: 1 });
    expect(rec.derivedFrom.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.plan.displayName).toBe("【架空】派生した清掃工場");
  });

  await test.step("トップ：派生した施設は元の施設の下に字下げし、元の版の印から線でつなぐ", async () => {
    await page.goto(`${bridge.base}/#/`);
    const rows = page.getByTestId("moyai-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-plan", source);
    await expect(rows.nth(1)).toHaveAttribute("data-depth", "1");
    await expect(rows.nth(1)).toContainText("【架空】派生した清掃工場");
    await expect(page.getByTestId("moyai-branch")).toHaveCount(1);
    // 「＋ 次の版」は、画面の幅に月の数を合わせて、いつも見える（1280px と、最小幅の 1024px）
    await expect(page.getByTestId("moyai-next").first()).toBeInViewport();
    await page.screenshot({ path: shot(`derive-top-${tag}`) });
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId("moyai-next").first()).toBeInViewport();
    expect(Number(await page.getByTestId("moyai-top").getAttribute("data-months"))).toBeLessThan(20);
  });
});
