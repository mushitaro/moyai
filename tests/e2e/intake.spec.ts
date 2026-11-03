// 取り込みの画面を、この PC の Chrome と Edge で開く：工場の fictional-1 の資料を落とし、全セルの行き先と未解決へ移ること、
// 質問に人が答えること、決定を取り消せること、止める決まりの間は主ボタンが押せず理由が出ること、計画を作って星取表で行が見えること。
import { expect, test } from "@playwright/test";
import { openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-intake-");
});
test.afterAll(() => bridge?.stop());

test("資料を落とし、質問に答え、計画を作って星取表で見る", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(120_000);

  await test.step("資料を落とすと、全セルの行き先が出る。【架空】の印を読み取る", async () => {
    await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場");
    await expect(page.getByTestId("fictional")).toBeChecked();
    await expect(page.getByTestId("fiction-mark")).toBeVisible();
    await expect(page.getByTestId("compose")).toBeDisabled();
    await expect(page.getByTestId("compose-disabled-reason")).toContainText("未解決のセル");
  });

  await test.step("未解決を押すと、そのセルへ移る", async () => {
    await page.getByTestId("jump-unresolved").first().click();
    const focused = page.locator('[data-testid="sheet-grid"] td[data-focus="true"]');
    await expect(focused).toHaveAttribute("data-s", "unresolved");
    await expect(page.getByTestId("cell-info")).toContainText("未解決");
    await page.screenshot({ path: shot(`intake-dropped-${tag}`), fullPage: true });
  });

  await test.step("質問に人が答える（既定の答えを選んだまま、1 問ずつ）", async () => {
    for (let i = 0; i < 40; i++) {
      const answer = page.getByTestId("answer").first();
      if ((await page.getByTestId("question").count()) === 0) break;
      await expect(answer).toBeEnabled();
      await answer.click();
      await page.waitForTimeout(50);
    }
    await expect(page.getByTestId("question")).toHaveCount(0);
    await expect(page.getByTestId("jump-unresolved")).toHaveCount(0);
    const authors = await page.getByTestId("decision").evaluateAll((els) => els.map((e) => e.getAttribute("data-author")));
    expect(authors.length).toBeGreaterThan(0);
    expect(new Set(authors)).toEqual(new Set(["human"]));
  });

  await test.step("決定を取り消すと止める決まりに戻り、答え直すと押せる", async () => {
    await expect(page.getByTestId("compose")).toBeEnabled();
    await page.getByTestId("undo").first().click();
    await expect(page.getByTestId("compose")).toBeDisabled();
    await expect(page.getByTestId("compose-disabled-reason")).toBeVisible();
    await page.getByTestId("answer").first().click();
    // 答えると次の質問が出ることがあるので、無くなるまで答える
    for (let i = 0; i < 20 && (await page.getByTestId("question").count()) > 0; i++) await page.getByTestId("answer").first().click();
    await expect(page.getByTestId("compose")).toBeEnabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveCount(0);
  });

  await test.step("計画を作り、星取表へ", async () => {
    await page.getByTestId("compose").click();
    await expect(page.getByTestId("composed")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot(`intake-composed-${tag}`), fullPage: true });
    await page.getByTestId("to-chart").click();
    await expect(page.getByTestId("chart-page")).toBeVisible();
    await expect(page.getByTestId("plan-name")).toHaveText("【架空】第一清掃工場");
    await expect(page.getByTestId("fiction-mark")).toBeVisible();
    await expect(page.locator(".ag-row").first()).toBeVisible();
    expect(Number(await page.getByTestId("chart-rows-count").getAttribute("data-total"))).toBeGreaterThan(10);
    await page.screenshot({ path: shot(`intake-chart-${tag}`) });
  });
});
