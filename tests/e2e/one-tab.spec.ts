// 作業画面は 1 つ（mushitaro/moyai#46）：作業（資料）のあるタブが開いているとき、あとから開いたタブは断られ、
// 「作業画面は別のタブで開いています。」の 1 行だけになる（中身も操作できるものも出さない）。前のタブはつながったまま。
import { expect, test, type Page } from "@playwright/test";
import { shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-one-tab-");
});
test.afterAll(() => bridge?.stop());

async function dropCsv(page: Page) {
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["設備,作業,日付\n【架空】ポンプ,点検,2024-04-01\n"], "daily-report.csv", { type: "text/csv" }));
    return d;
  });
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
}

test("作業のあるタブがあれば、あとから開いたタブは 1 行だけになり、前のタブはつながったまま", async ({ page, context }, info) => {
  await page.goto(`${bridge.base}/#/merge`);
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
  await dropCsv(page);
  await expect(page.getByText("daily-report.csv").first()).toBeVisible();

  const second = await context.newPage();
  await second.goto(`${bridge.base}/`);
  await expect(second.getByTestId("refused")).toHaveAttribute("data-code", "tab_elsewhere");
  await expect(second.locator("body")).toHaveText("作業画面は別のタブで開いています。");
  await second.screenshot({ path: shot(`one-tab-elsewhere-${info.project.name}`) });

  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
  await second.close();
});
