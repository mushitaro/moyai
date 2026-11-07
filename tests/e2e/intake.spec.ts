// 資料のシート（白紙、第 1 版の前）を、この PC の Chrome と Edge で開く：工場の fictional-1 の資料を落とすと、版があるときの資料のシートと同じ形
// （「資料」の札と資料の選び、未確定のいちばん多い資料の元の表と凡例の 1 行。docs/screens.md 3.2「資料の選び」・3.3）。見出しは施設の名前だけ（「第 1 版」の札は出さない）。
// 未確定のセルは朱の字と下の 2px の朱の線（四方の枠は選んだセルの印だけ）。選ぶと詳細に種別「未確定」と「質問　{題}」と「| 決める」、
// 押すと横の板の「未回答」でその質問を開く。除外のセルなら除外の理由。質問に人が「| 決める」で答えること、止める決まりの間は主ボタンが押せず理由「未回答 n」が出ること、
// 答えで決まったセルを選ぶと詳細に「答え　{答えの字}」と「人　{日時}」と「| 取り消す」が出て、取り消すと未回答に戻り、答え直すと押せること、
// 第 1 版をつくると見出しは「第 1 版　編集中」、資料のタブを選んだ形で、「| 資料を重ねて第 1 版をつくる」は出さず、星取表で行が見えること。
// つくったあとに答えを取り消すと、凡例の行の右端に「| 資料を重ねて第 1 版をつくる」が出ること（docs/screens.md 3.3 の末尾「写しの照らし」、Wire、11-07）。
import { expect, test } from "@playwright/test";
import { FICTIONAL_1, chooseSource, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

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

  await test.step("資料を落とすと、資料の選びに未確定のいちばん多い資料が開き、その元の表が出る。【架空】の印を読み取る", async () => {
    await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場");
    await expect(page.getByTestId("fiction-mark")).toBeVisible();
    // 見出しは施設の名前だけ：まだ版が無いので「第 1 版」の札も状態も出さない（つくる版の番号は下の帯の「第 1 版をつくる」）
    await expect(page.getByTestId("plan-name")).toHaveText("【架空】第一清掃工場");
    await expect(page.getByTestId("merge-version")).toHaveCount(0);
    await expect(page.getByTestId("merge-state")).toHaveCount(0);
    // 施設の欄は、資料が入ったら見出しの「施設設定」から開く
    await page.getByTestId("facility-settings").click();
    await expect(page.getByTestId("fictional")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fictional")).toHaveCount(0);
    // 「資料」の札と資料の選び（資料ごとのタブは並べない）。第 1 版の前は未確定のいちばん多い資料が開き、本体はその資料の元の表
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", String(FICTIONAL_1.files.length));
    await expect(page.getByTestId("sheet-file")).toHaveCount(0);
    const opened = (await page.getByTestId("source-picker").getAttribute("data-file")) ?? "";
    expect(FICTIONAL_1.files).toContain(opened);
    await expect(page.locator(`[data-testid="source-tab"][data-file="${opened}"]`)).toBeVisible();
    // 一覧を未確定の多い順にすると、開いた資料が先頭。Esc で閉じる
    await page.getByTestId("source-picker").click();
    await page.getByTestId("source-order").getByRole("button", { name: "未確定の多い順" }).click();
    await expect(page.getByTestId("source-row").first()).toHaveAttribute("data-file", opened);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("source-list")).toHaveCount(0);
    // ここからは最初の資料（設備台帳）で見る
    await chooseSource(page, first);
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

  await test.step("未確定のセル：朱の字と下の 2px の朱の線。選ぶと詳細に種別「未確定」と「質問　{題}」と「| 決める」。押すと「未回答」でその質問を開く。除外のセルなら除外の理由", async () => {
    const open = sourceGrid.locator('td[data-s="unresolved"]');
    // 選ぶ前：四方の枠は無く、下の線（内側の影）だけ
    await expect(open.first()).toHaveCSS("outline-style", "none");
    await expect(open.first()).toHaveCSS("box-shadow", /inset/);
    const detail = page.getByTestId("source-cell-detail");
    // 質問の分かるセルを選ぶ（questionId が null のセルは「質問」の行を出さない）
    const n = Math.min(await open.count(), 20);
    for (let i = 0; i < n; i++) {
      await open.nth(i).click();
      await expect(detail).toHaveAttribute("data-s", "unresolved");
      if ((await detail.getByTestId("cell-question-open").count()) > 0) break;
    }
    await expect(detail.getByTestId("cell-kind")).toHaveText("未確定");
    await expect(detail.getByTestId("cell-question-line")).toHaveText(/^質問　.+/);
    await expect(detail.getByTestId("cell-question-open")).toHaveText("決める");
    await expect(detail).not.toContainText("未解決");
    await expect(detail).not.toContainText("この質問に答えると決まります");
    // 選んだセルは枠で印を付ける
    await expect(sourceGrid.locator('td[data-focus="true"]')).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: shot(`intake-dropped-${tag}`), fullPage: true });
    // 「| 決める」：横の板の「未回答」で、その質問を開く
    const qid = await detail.getByTestId("cell-question").getAttribute("data-question");
    await detail.getByTestId("cell-question-open").click();
    await expect(page.getByTestId("side-open")).toHaveAttribute("aria-selected", "true");
    const focused = page.locator('[data-testid="question"][data-focus="true"]');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveAttribute("data-question", qid ?? "");
    await expect(focused).toBeInViewport();
    await page.screenshot({ path: shot(`intake-open-question-${tag}`), fullPage: true });
    await page.getByTestId("source-filter").locator("button", { hasText: "全行" }).click();
    await sourceGrid.locator('td[data-s="excluded"]').first().click();
    await expect(detail).toHaveAttribute("data-s", "excluded");
    await expect(detail).toContainText("除外：");
    await expect(detail.getByTestId("cell-kind")).toHaveCount(0);
  });

  // 答えは取り込みの worker が置く。置いて写しが届くまで、資料のシートに data-busy が付く（数えるのはそのあと）
  const settled = () => expect(page.getByTestId("intake-page")).not.toHaveAttribute("data-busy", "true");
  /** 既定の答えを選んだまま、質問が無くなるまで 1 問ずつ「| 決める」 */
  const answerAll = async () => {
    for (let i = 0; i < 40; i++) {
      const answer = page.getByTestId("answer").first();
      if ((await page.getByTestId("question").count()) === 0) break;
      await expect(answer).toHaveText("決める");
      await expect(answer).toBeEnabled();
      await answer.click();
      await settled();
    }
    await expect(page.getByTestId("question")).toHaveCount(0);
  };

  await test.step("質問に人が答える（既定の答え「- 既定」を選んだまま、1 問ずつ「| 決める」）", async () => {
    // 詳細を見ていたので、横の板を「未回答 n」に切り替える
    await page.getByTestId("side-open").click();
    await expect(page.getByTestId("side-open")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("question").first()).toContainText("- 既定");
    await expect(page.getByTestId("question-rows").first()).toHaveText(/^\d+ 行$/);
    await answerAll();
    // 未回答が 0 になると、横の板の「未回答 n」は消え、資料の未確定のセルも無くなる
    await expect(page.getByTestId("side-open")).toHaveCount(0);
    await expect(sourceGrid.locator('td[data-s="unresolved"]')).toHaveCount(0);
    await expect(page.getByTestId("compose")).toBeEnabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveCount(0);
  });

  await test.step("答えて、セルを選んで取り消して、答え直すと押せる", async () => {
    // 答えで決まったセル（読取）を選ぶと、詳細に 1 行目「答え　{答えの字}」、2 行目「人　{日時}」と右端に「| 取り消す」（折り返さない）
    await sourceGrid.locator('td[data-answered="true"]').first().click();
    const detail = page.getByTestId("source-cell-detail");
    await expect(detail).toHaveAttribute("data-s", "data");
    const row = detail.getByTestId("cell-answer").first();
    await expect(row.getByTestId("cell-answer-line")).toHaveText(/^答え　.+$/);
    await expect(row.getByTestId("cell-answer-line")).not.toContainText("　人　");
    await expect(row.getByTestId("cell-answer-by")).toHaveText(/^人　\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(row.getByTestId("cell-answer-undo")).toHaveText("取り消す");
    await expect(row.getByTestId("cell-answer-undo")).toHaveCSS("white-space", "nowrap");
    // 「取り消す」は 2 行目の右端（2 行目と同じ高さ、答えの行より下）
    const by = await row.getByTestId("cell-answer-by").boundingBox();
    const undoBox = await row.getByTestId("cell-answer-undo").boundingBox();
    const lineBox = await row.getByTestId("cell-answer-line").boundingBox();
    expect(by && undoBox && lineBox).toBeTruthy();
    expect(undoBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height - 1);
    expect(undoBox!.x).toBeGreaterThan(by!.x + by!.width);
    await page.screenshot({ path: shot(`intake-cell-answer-${tag}`), fullPage: true });
    // 取り消すと、その質問は未回答に戻り、同じ答えで決まったセルも未確定に戻る。主ボタンは押せず、理由「未回答 n」
    await row.getByTestId("cell-answer-undo").click();
    await settled();
    await expect(page.getByTestId("compose")).toBeDisabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveText(/^理由：未回答 \d+$/);
    await expect(page.getByTestId("side-open")).toContainText("未回答");
    // 戻ったセルは、答えの質問が決めていた資料にある（資料をまたぐ機器の質問なら、後の資料の側）。開いている資料とは限らないので、ここでは数を見ない
    // 答え直すと、また押せる
    await page.getByTestId("side-open").click();
    await answerAll();
    await expect(sourceGrid.locator('td[data-s="unresolved"]')).toHaveCount(0);
    await expect(page.getByTestId("compose")).toBeEnabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveCount(0);
  });

  await test.step("第 1 版をつくる：見出しは「第 1 版　編集中」。知らせの箱と決定の一覧と「| 資料を重ねて第 1 版をつくる」は出さず、資料を 1 つ選んだ形のまま。星取表のタブで見る", async () => {
    await page.getByTestId("compose").click();
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 20_000 });
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose-by", "human");
    await expect(page.getByTestId("merge-version")).toHaveText("第 1 版");
    await expect(page.getByTestId("merge-state")).toHaveText("編集中");
    // つくった直後は、つくった版に入っていない変更が無いので出さない
    await expect(page.getByTestId("source-tab")).toBeVisible();
    await expect(page.getByTestId("compose")).toHaveCount(0);
    await expect(page.getByTestId("merge-page")).not.toContainText("資料を重ねて");
    await expect(page.getByTestId("sheet-chart")).toBeVisible();
    await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
    await expect(page.getByTestId("source-pick")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-file", first);
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

  await test.step("突き合せ：資料をまたいで結んだ作業を、資料ごとに並べる。重ねた資料は資料の選びで開く", async () => {
    await page.getByTestId("sheet-match").click();
    await expect(page.getByTestId("match-sheet")).toBeVisible();
    // 切り替えの「すべて」で、結んだ作業が並ぶ（星取表と作業日報の両方の列）
    await page.getByTestId("match-filter").getByText(/^全件 \d+$/).click();
    expect(await page.getByTestId("match-row").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("match-table")).toContainText("plan-hoshitori.xlsx");
    await expect(page.getByTestId("match-table")).toContainText("daily-report.csv");
    await expect(page.locator('[data-testid="match-row"][data-result="ok"]').first()).toContainText("✓ 一致");
    await page.screenshot({ path: shot(`intake-match-${tag}`) });
    // 資料の選び：一覧で選ぶと、資料のシートでその資料を見せる
    await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "3");
    await chooseSource(page, "daily-report.csv");
    await expect(page.getByTestId("source-pick")).toHaveAttribute("data-selected", "true");
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

  await test.step("つくったあとに答えを取り消すと、凡例の行の右端に「| 資料を重ねて第 1 版をつくる」。答え直すと押せ、つくり直すとまた出さない", async () => {
    await chooseSource(page, first);
    await expect(page.locator(`[data-testid="source-tab"][data-file="${first}"]`)).toBeVisible();
    await expect(page.getByTestId("compose")).toHaveCount(0);
    await page.getByTestId("source-filter").locator("button", { hasText: "全行" }).click();
    await sourceGrid.locator('td[data-answered="true"]').first().click();
    const detail = page.getByTestId("source-cell-detail");
    await detail.getByTestId("cell-answer-undo").first().click();
    await settled();
    // 凡例の行の右端（資料のタブの中、凡例と同じ行）。押せない理由は「理由：未回答 n」
    const compose = page.locator('[data-testid="source-tab"] [data-testid="compose"]');
    await expect(compose).toHaveText("資料を重ねて第 1 版をつくる");
    await expect(compose).toBeDisabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveText(/^理由：未回答 \d+$/);
    const legend = await page.getByTestId("source-legend").boundingBox();
    const box = await compose.boundingBox();
    const grid = await sourceGrid.boundingBox();
    expect(legend && box && grid).toBeTruthy();
    // 凡例と同じ行（縦に重なる）で、表より上
    expect(box!.y).toBeLessThan(legend!.y + legend!.height);
    expect(box!.y + box!.height).toBeGreaterThan(legend!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(grid!.y);
    expect(box!.x).toBeGreaterThan(legend!.x + legend!.width);
    await page.screenshot({ path: shot(`intake-compose-next-${tag}`), fullPage: true });
    await page.getByTestId("side-open").click();
    await answerAll();
    await expect(compose).toBeEnabled();
    await expect(page.getByTestId("compose-disabled-reason")).toHaveCount(0);
    await compose.click();
    await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 20_000 });
    await expect(page.getByTestId("compose")).toHaveCount(0);
  });
});
