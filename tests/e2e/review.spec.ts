// 検査の画面を、この PC の Chrome と Edge で端から端まで（docs/plan.md §2.14・§6.1 の 3）：
// 人が資料を落とし、AI が MCP で取り込み → 当てはめの案、試験の台本が人の代わりに画面で規則ごとに受ける
// → 作業画面から【検査】を開く → 基準日を選ぶ → 検査ごとの結果・根拠の数字・例・出典・水準・閾値の出どころ・確かめた度合いと、
// 「自己点検であって、審査の判断ではない」が出る。主ボタンは無い。AI が check_results で読んだ数は画面と同じ。
// AI は本物の中継（dist/cli.js mcp）を MCP の SDK のクライアントでつなぐ。先に npm run build を走らせておく。
import { expect, test } from "@playwright/test";
import { f1Rules } from "../fixtures/crosswalk/rules";
import { acceptRules, callTool as call, mcpClient, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】検査の画面";
const HUMAN = "試験の台本が押した（台帳の名前とパックの項目を見て合っている）";
const REFERENCE = "2026-10-01";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-review-");
});
test.afterAll(() => bridge?.stop());

test("取り込み → 当てはめ → 検査の画面と check_results", async ({ page }, info) => {
  test.setTimeout(240_000);
  const tag = info.project.name;
  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "crosswalk_propose", "check_results"]);
  try {
    await test.step("計画が無いうちは、MERGE は白紙で検査のシートが無く、AI には「作業中の計画が無い」", async () => {
      await page.goto(`${bridge.base}/#/review`);
      await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
      await expect(page.getByTestId("sheet-check")).toHaveCount(0);
      const r: any = await c.callTool({ name: "check_results", arguments: {} });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain("作業中の計画");
    });

    await test.step("人が資料を落とし、AI が計画を作り、当てはめの案を置き、試験の台本が人の代わりに受ける", async () => {
      await openIntakeAndDrop(page, bridge.base, FACILITY);
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        await call(c, "intake_settle", {
          decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" })),
        });
      }
      expect((await call(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("composed")).toContainText("AI が作りました", { timeout: 20_000 });
      const version = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk.version;
      const { nodes, works } = f1Rules();
      const rules = [...nodes, ...works];
      await call(c, "crosswalk_propose", { rules, basedOnVersion: version });
      // 当てはめの案は、MERGE の決定のシートに並ぶ
      await page.getByTestId("sheet-decisions").click();
      await expect(page.getByTestId("crosswalk-rule")).toHaveCount(rules.length);
      expect(await acceptRules(page, HUMAN)).toBe(rules.length);
      // 当てはめを受けた機器の節（fictional-1 は計画 §2.5 の厚さで機器 217）
      await expect(page.getByTestId("crosswalk-accepted")).toHaveAttribute("data-nodes", "217");
    });

    await test.step("人：開発の道具（設定の画面の下）から検査を開き、基準日を選ぶ", async () => {
      // 読み込み直さずに設定の画面へ（作業中の計画はこのタブのメモリにある）
      await page.evaluate(() => (location.hash = "#/settings"));
      await page.getByRole("link", { name: "検査", exact: true }).click();
      await expect(page.getByTestId("check-sheet")).toBeVisible();
      await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "check");
      await expect(page.getByTestId("plan-name")).toContainText(FACILITY);
      // 「自己点検であって…」は画面に出さない（AI のツールの結果にだけ添える）
      await expect(page.getByTestId("review-notice")).toHaveCount(0);
      await expect(page.getByTestId("fiction-mark").first()).toBeVisible();
      // 基準日は上の 1 行の右に出し、「変える」を押したときだけ日付の欄を出す
      await page.getByTestId("reference-date-edit").click();
      await page.getByTestId("reference-date").fill(REFERENCE);
      await expect(page.getByTestId("reference-date-text")).toContainText(REFERENCE);
    });

    await test.step("1 つの外れを 1 行（印・検査・機器・この施設・基準・出典）。行を選ぶと横の板の詳しくに、水準・出典の全文・確かめた度合い。主ボタンは無い", async () => {
      // 切り替えの既定は外れ。外れの行は機器ごと
      await expect(page.getByTestId("check-table")).toHaveAttribute("data-kind", "notMet");
      const line = (id: string) => page.locator(`[data-testid="check-line"][data-check="${id}"]`);
      // 精密機能検査の間隔：入れた欠け 2 つ（6 年度の間）
      await expect(line("WI-PRECISION-INTERVAL")).toHaveCount(2);
      await expect(line("WI-PRECISION-INTERVAL").first()).toContainText("焼却炉本体");
      await expect(line("WI-PRECISION-INTERVAL").first()).toContainText("6 年");
      await expect(line("WI-PRECISION-INTERVAL").first()).toContainText("3 年以内");
      await expect(line("WI-PRECISION-INTERVAL").first()).toContainText("第三の 11");
      for (const id of ["WI-PLAN-DONE", "WI-PLAN-COVERAGE"]) await expect(line(id)).toHaveCount(2);
      await line("WI-PRECISION-INTERVAL").first().click();
      const d = page.getByTestId("check-detail");
      await expect(d).toBeVisible();
      await expect(d).toContainText("推奨");
      await expect(d).toContainText("原典照合済");
      await expect(d).toContainText("第三の 11");
      await expect(d.getByTestId("check-open-source")).toHaveAttribute("href", "https://www.env.go.jp/hourei/11/000510.html");
      await expect(d).toContainText("基準日の年度：2026 年度");
      await page.screenshot({ path: shot(`review-${tag}`), fullPage: true });
      // 当てはまらない：判定の値の無い計画では、健全度の検査
      await page.getByTestId("check-kind").getByRole("button", { name: /当てはまらない/ }).click();
      await expect(line("WI-HEALTH-SCALE")).toHaveAttribute("data-result", "notApplicable");
    });

    await test.step("AI：check_results で読む。画面と同じ基準日で、同じ結果と件数", async () => {
      const r = await call(c, "check_results");
      expect(r.notice).toBe("自己点検であって、審査の判断ではない");
      expect(r.referenceDate).toBe(REFERENCE);
      const lines = async (kind: string) => {
        await page.getByTestId("check-kind").getByRole("button", { name: new RegExp(`^${kind}`) }).click();
        return page.getByTestId("check-line");
      };
      // 外れの行の数は、外れの例の数の和（例の無い外れは 1 行）
      const notMet = r.checks.filter((k: any) => k.result === "notMet");
      await expect(await lines("外れ")).toHaveCount(notMet.reduce((a: number, k: any) => a + Math.max(1, k.examples.length), 0));
      await expect(await lines("満たす")).toHaveCount(r.checks.filter((k: any) => k.result === "met").length);
      const one = await call(c, "check_results", { checkId: "WI-PRECISION-INTERVAL" });
      expect(one.checks).toHaveLength(1);
      expect(one.checks[0].examples.map((e: any) => e.fiscalYears)).toEqual([
        [2019, 2025],
        [2020, 2026],
      ]);
    });

    await test.step("人が基準日を 1 年進めると、画面も AI の結果も同じ日で走り直す", async () => {
      await page.getByTestId("reference-date").fill("2027-04-01");
      await expect(page.getByTestId("reference-date-text")).toContainText("2027-04-01");
      const r = await call(c, "check_results", { checkId: "WI-PLAN-DONE" });
      expect(r.referenceDate).toBe("2027-04-01");
      expect(r.checks[0].count).toBeGreaterThan(2);
      await page.getByTestId("check-kind").getByRole("button", { name: /^外れ/ }).click();
      await expect(page.locator('[data-testid="check-line"][data-check="WI-PLAN-DONE"]')).toHaveCount(Math.max(1, r.checks[0].examples.length));
    });
  } finally {
    await c.close();
  }
});
