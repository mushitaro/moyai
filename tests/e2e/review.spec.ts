// 検査の画面を、この PC の Chrome と Edge で端から端まで（docs/plan.md §2.14・§6.1 の 3）：
// 人が資料を落とし、AI が MCP で取り込み → 当てはめの案、試験の台本が人の代わりに画面で規則ごとに受ける
// → 作業画面から【検査】を開く → 基準日を選ぶ → 検査ごとの結果・根拠の数字・例・出典・水準・閾値の出どころ・確かめた度合いと、
// 「自己点検であって、審査の判断ではない」が出る。主ボタンは無い。AI が check_results で読んだ数は画面と同じ。
// AI は本物の中継（dist/cli.js mcp）を MCP の SDK のクライアントでつなぐ。先に npm run build を走らせておく。
import { expect, test } from "@playwright/test";
import { f1Rules } from "../fixtures/crosswalk/rules";
import { callTool as call, mcpClient, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

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
    await test.step("計画が無いうちは、検査は「計画がまだありません」と出し、AI には「作業中の計画が無い」", async () => {
      await page.goto(`${bridge.base}/#/review`);
      await expect(page.getByTestId("review-page")).toBeVisible();
      await expect(page.getByTestId("review-notice")).toContainText("自己点検であって、審査の判断ではない");
      await expect(page.getByTestId("review-empty")).toBeVisible();
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
      const rows = page.getByTestId("crosswalk-rule");
      await expect(rows).toHaveCount(rules.length);
      for (let i = 0; i < rules.length; i++) {
        const row = rows.nth(i);
        await row.getByTestId("crosswalk-reason").fill(HUMAN);
        await row.getByTestId("crosswalk-accept").click();
        await expect(row).toHaveAttribute("data-state", "accepted");
      }
      await expect(page.getByTestId("crosswalk-accepted")).toHaveAttribute("data-nodes", "25");
    });

    await test.step("人：作業画面から検査を開き、基準日を選ぶ", async () => {
      // 読み込み直さずに作業画面へ（作業中の計画はこのタブのメモリにある）
      await page.evaluate(() => (location.hash = "#/"));
      await page.getByRole("link", { name: "検査", exact: true }).click();
      await expect(page.getByTestId("review-page")).toBeVisible();
      await expect(page.getByTestId("review-plan")).toContainText(FACILITY);
      await expect(page.getByTestId("fiction-mark").first()).toBeVisible();
      await page.getByTestId("reference-date").fill(REFERENCE);
      await expect(page.getByTestId("review-fy")).toHaveText("基準日の年度：2026 年度");
    });

    await test.step("検査ごとの結果・根拠の数字・例・出典・水準・閾値の出どころ・確かめた度合い。主ボタンは無い", async () => {
      const cards = page.getByTestId("check");
      expect(await cards.count()).toBeGreaterThanOrEqual(5);
      const card = (id: string) => page.locator(`[data-testid="check"][data-check="${id}"]`);
      // 精密機能検査の間隔：入れた欠け 2 つ（6 年度の間）。推奨・閾値は出典・原典照合済、出典は課長通知の第三の 11
      const interval = card("WI-PRECISION-INTERVAL");
      await expect(interval).toHaveAttribute("data-result", "notMet");
      await expect(interval).toHaveAttribute("data-count", "2");
      await expect(interval.getByTestId("check-result")).toHaveText("外れがある");
      await expect(interval.getByTestId("check-level")).toHaveAttribute("data-level", "recommendation");
      await expect(interval.getByTestId("check-threshold")).toHaveText("出典");
      await expect(interval.getByTestId("check-verification")).toHaveText("原典照合済");
      await expect(interval.getByTestId("check-source")).toContainText("第三の 11");
      await expect(interval.getByTestId("check-source").getByRole("link")).toHaveAttribute("href", "https://www.env.go.jp/hourei/11/000510.html");
      await expect(interval.getByTestId("check-example")).toHaveCount(2);
      await expect(interval.getByTestId("check-example").first()).toContainText("焼却炉本体");
      await expect(interval.getByTestId("check-example").first()).toContainText("間が 6 年度");
      await expect(interval.getByTestId("check-numbers")).toContainText("閾値の年数");
      // 過ぎた予定の実績・計画の期間の予定：入れた欠けが 2 つずつ。出典の無いアプリの目安
      for (const id of ["WI-PLAN-DONE", "WI-PLAN-COVERAGE"]) {
        await expect(card(id)).toHaveAttribute("data-result", "notMet");
        await expect(card(id)).toHaveAttribute("data-count", "2");
        await expect(card(id).getByTestId("check-source")).toHaveText("出典なし（アプリの目安）");
        await expect(card(id).getByTestId("check-level")).toHaveText("アプリの目安");
      }
      // 判定の値の無い計画：健全度の検査は当てはまらない
      await expect(card("WI-HEALTH-SCALE")).toHaveAttribute("data-result", "notApplicable");
      await expect(card("WI-HEALTH-SCALE").getByTestId("check-na")).toHaveText("判定の値のある記録が無い");
      // 未実装と、作っていない検査を出す
      await expect(card("WI-PLAN-FIELDS").getByTestId("check-unimplemented")).toContainText("未実装");
      await expect(page.getByTestId("review-not-made")).toBeVisible();
      await expect(page.getByTestId("review-unimplemented")).toContainText("延長の承認の記録");
      // 主ボタンは無い（この画面のボタンは 0）
      await expect(page.getByTestId("review-page").getByRole("button")).toHaveCount(0);
      await page.screenshot({ path: shot(`review-${tag}`), fullPage: true });
    });

    await test.step("AI：check_results で読む。画面と同じ基準日で、同じ結果と件数", async () => {
      const r = await call(c, "check_results");
      expect(r.notice).toBe("自己点検であって、審査の判断ではない");
      expect(r.referenceDate).toBe(REFERENCE);
      const cards = page.getByTestId("check");
      expect(r.checks.length).toBe(await cards.count());
      for (const k of r.checks) {
        const el = page.locator(`[data-testid="check"][data-check="${k.checkId}"]`);
        await expect(el).toHaveAttribute("data-result", k.result);
        await expect(el).toHaveAttribute("data-count", String(k.count));
      }
      const one = await call(c, "check_results", { checkId: "WI-PRECISION-INTERVAL" });
      expect(one.checks).toHaveLength(1);
      expect(one.checks[0].examples.map((e: any) => e.fiscalYears)).toEqual([
        [2019, 2025],
        [2020, 2026],
      ]);
    });

    await test.step("人が基準日を 1 年進めると、画面も AI の結果も同じ日で走り直す", async () => {
      await page.getByTestId("reference-date").fill("2027-04-01");
      await expect(page.getByTestId("review-fy")).toHaveText("基準日の年度：2027 年度");
      const r = await call(c, "check_results", { checkId: "WI-PLAN-DONE" });
      expect(r.referenceDate).toBe("2027-04-01");
      await expect(page.locator('[data-testid="check"][data-check="WI-PLAN-DONE"]')).toHaveAttribute("data-count", String(r.checks[0].count));
      expect(r.checks[0].count).toBeGreaterThan(2);
    });
  } finally {
    await c.close();
  }
});
