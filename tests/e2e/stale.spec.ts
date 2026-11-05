// 2 人が同時に書こうとしたとき（docs/screens.md 4 の 6、P2 の 4）を、この PC の Chrome と Edge で通す：
// 山田が第 1 版に署名し、MERGE で開いたまま → そのあいだに課長（別の MOYAI、保管先は同じ）が第 1 版から第 2 版に署名
// → 山田がタブに戻ると「保管先に新しい版（第 2 版、課長）があります…」と出て、署名は止まる（黙って上書きしない）
// → 「開き直す」で第 2 版を開くと、知らせは消え、次は第 3 版。AI は使わない。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const A = { name: "【架空】山田" };
const B = { name: "【架空】課長" };

let one: StartedBridge;
let two: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-stale-"));
  one = await startBuiltBridge("moyai-e2e-stale-a-");
  two = await startBuiltBridge("moyai-e2e-stale-b-");
});
test.afterAll(() => {
  one?.stop();
  two?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function settings(page: Page, base: string, root: string, name: string) {
  await page.goto(`${base}/#/settings`);
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("current-name")).toHaveText(name);
}

test("ほかの人が新しい版を足したら知らせて署名を止め、開き直すとその版に重ねる", async ({ browser }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "共有の保管先");
  const pa = await (await browser.newContext()).newPage();
  const pb = await (await browser.newContext()).newPage();

  await test.step("山田：見本の計画を第 1 版として署名し、MERGE で開いたままにする", async () => {
    await settings(pa, one.base, root, A.name);
    const body = JSON.stringify(DEV_PLANS["fictional-1"]());
    await pa.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await pa.goto(`${one.base}/?plan=fictional-1#/merge/chart`);
    await expect(pa.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(pa, "試験の台本が押した（山田が受けた）");
    await pa.getByTestId("confirm-open").click();
    await pa.getByTestId("confirm-reason").fill("山田の第 1 版（e2e）");
    await signInDialog(pa);
    await pa.getByTestId("confirm-submit").click();
    await expect(pa.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    await pa.keyboard.press("Escape");
    await expect(pa.getByTestId("merge-version")).toHaveText("第 2 版");
    await expect(pa.getByTestId("merge-stale")).toHaveCount(0);
  });

  await test.step("課長：別の MOYAI で同じ保管先。トップの「＋ 次の版」で第 1 版を開き、第 2 版に署名する", async () => {
    await settings(pb, two.base, root, B.name);
    await pb.goto(`${two.base}/#/`);
    await pb.getByTestId("moyai-next").click();
    await expect(pb.getByTestId("merge-version")).toHaveText("第 2 版");
    await pb.getByTestId("confirm-open").click();
    await pb.getByTestId("confirm-reason").fill("課長が見直した第 2 版（e2e）");
    await signInDialog(pb);
    await pb.getByTestId("confirm-submit").click();
    await expect(pb.getByTestId("confirm-done")).toContainText("第 2 版に署名しました");
  });

  await test.step("山田：タブに戻ると、保管先に新しい版があると出て、署名は止まる", async () => {
    await pa.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(pa.getByTestId("merge-stale")).toContainText("保存先に新しい版（第 2 版、【架空】課長）があります。");
    // 見出しは、この編集がつくるつもりの版（第 1 版の次）
    await expect(pa.getByTestId("merge-version")).toHaveText("第 2 版");
    await expect(pa.getByTestId("confirm-open")).toBeDisabled();
    await expect(pa.getByTestId("confirm-disabled-reason")).toContainText("保存先に新しい版があります");
    await pa.screenshot({ path: shot(`stale-${tag}`) });
  });

  await test.step("山田：「開き直す」で第 2 版を開くと、知らせは消え、次は第 3 版", async () => {
    await pa.getByTestId("merge-reopen").click();
    await expect(pa.getByTestId("merge-version")).toHaveText("第 3 版");
    await expect(pa.getByTestId("merge-stale")).toHaveCount(0);
    await expect(pa.getByTestId("merge-compare")).toHaveAttribute("data-version", "2");
  });
});
