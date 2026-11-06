// 資料のシート（白紙、第 1 版の前）を、この PC の Chrome と Edge で開く：工場の fictional-1 の資料を落とすと、版があるときの資料のシートと同じ形
// （「資料」の札と資料ごとのタブ、最初の資料の元の表と凡例の 1 行。docs/screens.md 3.3）。未確定のセルと除外のセルを選ぶと詳細に行き先と理由、
// 質問に人が「| 決める」で答えること、止める決まりの間は主ボタンが押せず理由「未回答 n」が出ること、第 1 版をつくっても資料のタブを選んだ形で、星取表で行が見えること。
import { expect, test } from "@playwright/test";
import { FICTIONAL_1, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-intake-");
});
test.afterAll(() => bridge?.stop());

test("資料を落とし、質問に答え、第 1 版をつくって星取表で見る", async ({ page }, info) => {
  const tag = info.project.name;
  // 厚くしたサンプルは質問が多く、1 問ずつ答えるので時間がかかる
  test.setTimeout(240_000);
  const first = FICTIONAL_1.files[0]!;
  const sourceGrid = page.locator('[data-testid="source-tab"] [data-testid="sheet-grid"]');

  await test.step("資料を落とすと、資料のタブが並び、最初の資料の元の表が出る。【架空】の印を読み取る", async () => {
    await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場");
    await expect(page.getByTestId("fiction-mark")).toBeVisible();
    // 施設の欄は、資料が入ったら見出しの「施設設定」から開く
    await page.getByTestId("facility-settings").click();
    await expect(page.getByTestId("fictional")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fictional")).toHaveCount(0);
    // 「資料」の札と資料ごとのタブ。最初の資料が選ばれ、本体はその資料の元の表（資料を 1 つのタブに積まない）
    await expect(page.getByTestId("sheet-file")).toHaveCount(FICTIONAL_1.files.length);
    await expect(page.locator(`[data-testid="sheet-file"][data-file="${first}"]`)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`[data-testid="source-tab"][data-file="${first}"]`)).toBeVisible();
    await expect(page.getByTestId("source-filter")).toContainText("未確定行");
    await expect(page.getByTestId("source-legend")).toContainText("読取");
    // 資料ごとの数の行（データ n セル・入れた行 n＝…）と、資料の落とし場所は出さない
    await expect(page.getByTestId("dest-file")).toHaveCount(0);
    await expect(page.getByTestId("drop")).toHaveCount(0);
    await expect(page.getByTestId("intake-page")).not.toContainText("入れた行");
    // 押せない理由は「理由：未回答 n」（セルの数は出さない）
    await expect(page.getByTestId("compose")).toBeDisabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveText(/^理由：未回答 \d+$/);
    await expect(page.getByTestId("side-band-open").or(page.getByTestId("side-open"))).toContainText("未回答");
  });

  await test.step("未確定のセルを選ぶと、横の板の詳細にそのセルの質問。除外のセルなら除外の理由", async () => {
    await sourceGrid.locator('td[data-s="unresolved"]').first().click();
    const detail = page.getByTestId("source-cell-detail");
    await expect(detail).toHaveAttribute("data-s", "unresolved");
    await expect(detail).toContainText("未解決");
    await page.screenshot({ path: shot(`intake-dropped-${tag}`), fullPage: true });
    await page.getByTestId("source-filter").locator("button", { hasText: "全行" }).click();
    await sourceGrid.locator('td[data-s="excluded"]').first().click();
    await expect(detail).toHaveAttribute("data-s", "excluded");
    await expect(detail).toContainText("除外：");
  });

  // 答えは取り込みの worker が置く。置いて写しが届くまで、資料のシートに data-busy が付く（数えるのはそのあと）
  const settled = () => expect(page.getByTestId("intake-page")).not.toHaveAttribute("data-busy", "true");

  await test.step("質問に人が答える（既定の答え「- 既定」を選んだまま、1 問ずつ「| 決める」）", async () => {
    // 詳細を見ていたので、横の板を「未回答 n」に切り替える
    await page.getByTestId("side-open").click();
    await expect(page.getByTestId("question").first()).toContainText("- 既定");
    await expect(page.getByTestId("question-rows").first()).toHaveText(/^\d+ 行$/);
    for (let i = 0; i < 40; i++) {
      const answer = page.getByTestId("answer").first();
      if ((await page.getByTestId("question").count()) === 0) break;
      await expect(answer).toHaveText("決める");
      await expect(answer).toBeEnabled();
      await answer.click();
      await settled();
    }
    await expect(page.getByTestId("question")).toHaveCount(0);
    // 未回答が 0 になると、横の板の「未回答 n」は消え、資料の未確定のセルも無くなる
    await expect(page.getByTestId("side-open")).toHaveCount(0);
    await expect(sourceGrid.locator('td[data-s="unresolved"]')).toHaveCount(0);
    await expect(page.getByTestId("compose")).toBeEnabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveCount(0);
  });

  await test.step("第 1 版をつくる：知らせの箱と決定の一覧は出さず、資料のタブを 1 つ選んだ形のまま。星取表のタブで見る", async () => {
    await page.getByTestId("compose").click();
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 20_000 });
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose-by", "human");
    await expect(page.getByTestId("sheet-chart")).toBeVisible();
    await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
    await expect(page.locator('[data-testid="sheet-file"][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator(`[data-testid="sheet-file"][data-file="${first}"]`)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("composed")).toHaveCount(0);
    await expect(page.getByTestId("decisions")).toHaveCount(0);
    await expect(page.getByTestId("merge-page")).not.toContainText("決定の一覧");
    await expect(page.getByTestId("merge-page")).not.toContainText("画面で作りました");
    await page.screenshot({ path: shot(`intake-composed-${tag}`), fullPage: true });
    await page.getByTestId("sheet-chart").click();
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
