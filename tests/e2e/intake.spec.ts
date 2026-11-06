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
  // 厚くしたサンプルは質問が多く、1 問ずつ答えるので時間がかかる
  test.setTimeout(240_000);

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

  // 答えは取り込みの worker が置く。置いて写しが届くまで、取り込みの画面に data-busy が付く（数えるのはそのあと）
  const settled = () => expect(page.getByTestId("intake-page")).not.toHaveAttribute("data-busy", "true");

  await test.step("質問に人が答える（既定の答えを選んだまま、1 問ずつ）", async () => {
    for (let i = 0; i < 40; i++) {
      const answer = page.getByTestId("answer").first();
      if ((await page.getByTestId("question").count()) === 0) break;
      await expect(answer).toBeEnabled();
      await answer.click();
      await settled();
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
    await settled();
    await expect(page.getByTestId("compose")).toBeDisabled();
    await expect(page.getByTestId("compose-disabled-reason")).toBeVisible();
    await page.getByTestId("answer").first().click();
    await settled();
    // 答えると次の質問が出ることがあるので、無くなるまで答える
    for (let i = 0; i < 20 && (await page.getByTestId("question").count()) > 0; i++) {
      await page.getByTestId("answer").first().click();
      await settled();
    }
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

  await test.step("突き合せ：資料をまたいで結んだ作業を、資料ごとに並べる。重ねた資料は資料ごとのタブ", async () => {
    await page.getByTestId("sheet-match").click();
    await expect(page.getByTestId("match-sheet")).toBeVisible();
    // 切り替えの「すべて」で、結んだ作業が並ぶ（星取表と作業日報の両方の列）
    await page.getByTestId("match-filter").getByText(/^全件 \d+$/).click();
    expect(await page.getByTestId("match-row").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("match-table")).toContainText("plan-hoshitori.xlsx");
    await expect(page.getByTestId("match-table")).toContainText("daily-report.csv");
    await expect(page.locator('[data-testid="match-row"][data-result="ok"]').first()).toContainText("✓ 一致");
    await page.screenshot({ path: shot(`intake-match-${tag}`) });
    // 資料ごとのタブ：押すと、資料のシートでその資料を見せる
    await expect(page.getByTestId("sheet-file")).toHaveCount(3);
    await page.locator('[data-testid="sheet-file"][data-file="daily-report.csv"]').click();
    await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
    await expect(page.locator('[data-testid="sheet-file"][data-file="daily-report.csv"]')).toHaveAttribute("aria-selected", "true");
    // 資料のタブはその資料 1 つだけ（MERGE r2）：切り替え「未確定行 n ／ 全行 n」と凡例、元の表。行き先の一覧と AI の作業の記録は置かない
    await expect(page.locator('[data-testid="source-tab"][data-file="daily-report.csv"]')).toBeVisible();
    await expect(page.getByTestId("source-filter")).toContainText("全行");
    await expect(page.getByTestId("source-legend")).toContainText("読取");
    await expect(page.getByTestId("dest-file")).toHaveCount(0);
    // セルを選ぶと、横の板の詳細にそのセルの行き先
    await page.locator('[data-testid="source-tab"] [data-testid="sheet-grid"] td[data-ref]:not([data-ref=""])').first().click();
    await expect(page.getByTestId("source-cell-detail")).toBeVisible();
    await page.screenshot({ path: shot(`intake-source-${tag}`) });
  });
});
