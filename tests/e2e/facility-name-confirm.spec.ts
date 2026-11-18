// 施設の名前を変える（2026-11-18、運営者が M-PC3 で見つけた不具合）：Claude が chart_propose の facilityName で案を置く → 確定のシートに並ぶ →
// 人が受けて署名して確定 → 新しい版の施設名・MOYAI のトップの行の名前・HOSHITORI の見出しが新しい名前になる。
// 【架空】の施設は【架空】の印を残したまま、名前の残りを変えられる。
// 署名して確定したら、MOYAI のトップに戻る（作業中の計画は勝手に開かない。次の版は人が「＋ 次の版」を押したときだけ）。
// 先に npm run build を走らせておく。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { acceptDecisions, callTool as call, chooseRoot, mcpClient as connect, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let root = "";
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-name-");
  root = mkdtempSync(join(tmpdir(), "moyai-e2e-name-root-"));
});
test.afterAll(() => {
  bridge?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

const OLD = "【架空】第一清掃工場（名前）";
const NEW = "【架空】みなと清掃工場";

test("Claude の名前の案を人が受けて署名すると、版・トップ・見出しが新しい名前になり、確定のあとはトップに戻る", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const c = await connect(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "chart_propose"]);
  try {
    await test.step("資料を落とし、AI が答えを置いて第 1 版の計画を作る", async () => {
      await chooseRoot(page, bridge.base, root);
      await openIntakeAndDrop(page, bridge.base, OLD);
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        await call(c, "intake_settle", {
          decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで既定の答えでよいと答えた" })),
        });
      }
      await call(c, "intake_compose");
      for (let i = 0; i < 50; i++) {
        const s = await call(c, "intake_survey", { part: "compose" });
        if (s.compose.state !== "running") break;
        await page.waitForTimeout(100);
      }
    });

    let planId = "";
    await test.step("Claude が名前の案を置く（【架空】の印は外せない）", async () => {
      const cw = await call(c, "intake_survey", { part: "crosswalk" });
      const r: any = await c.callTool({ name: "chart_propose", arguments: { basedOnVersion: cw.crosswalk.version, basis: "利用者が名前を直してと言った", author: "ai_relayed_human", facilityName: "みなと清掃工場" } });
      expect(r.isError).toBe(true);
      await call(c, "chart_propose", { basedOnVersion: cw.crosswalk.version, basis: "利用者が名前を直してと言った", author: "ai_relayed_human", facilityName: NEW });
      const rows = await call(c, "chart_rows", { limit: 1 });
      expect(rows.source).toBe("working");
      await page.getByTestId("sheet-decisions").click();
      await expect(page.locator('[data-testid="pending-row"][data-decision-kind="facilityName"]')).toContainText(NEW);
    });

    await test.step("人が受けて署名して確定する", async () => {
      expect(await acceptDecisions(page, "名前は利用者に確かめた")).toBeGreaterThan(0);
      // 受けたあと、署名の前：見出しは今の名前のまま、右に「→ 新しい名前　確定前」（名前が替わるのは署名した版から）
      await expect(page.getByTestId("plan-name")).toHaveText(OLD);
      await expect(page.getByTestId("plan-name-accepted")).toHaveText(`→ ${NEW}　確定前`);
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("名前を直して確定する（e2e）");
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText("確定しました");
      const plans = readdirSync(join(root, "plans"));
      expect(plans).toHaveLength(1);
      planId = plans[0]!;
      const rec = JSON.parse(readFileSync(join(root, "plans", planId, "versions", "000001.json"), "utf8"));
      expect(rec.plan.displayName).toBe(NEW);
      expect(rec.plan.facility.name).toBe(NEW);
      expect(rec.plan.nameProposal).toBeUndefined();
      await page.screenshot({ path: shot(`name-confirmed-${tag}`) });
      await page.getByTestId("confirm-close").click();
    });

    await test.step("確定のあとは MOYAI のトップに戻り、確定した版の行が新しい名前で見える。作業中の計画は開かない", async () => {
      await expect(page.getByTestId("moyai-top")).toBeVisible();
      const row = page.locator(`[data-testid="moyai-row"][data-plan="${planId}"]`);
      await expect(row).toContainText(NEW);
      await expect(row).not.toContainText(OLD);
      await expect(row.getByTestId("moyai-work")).toHaveCount(0);
      await expect(row.getByTestId("moyai-version")).toContainText("第 1 版");
      // 作業中の計画は無い（AI からは確定版を読むだけ）
      const r = await call(c, "chart_rows", { limit: 1 });
      expect(r.source).toBe("confirmed");
      expect(r.confirmed.facilityName).toBe(NEW);
      await page.screenshot({ path: shot(`name-top-${tag}`) });
    });

    await test.step("人が「＋ 次の版」を押すと、見出しも新しい名前のまま（作り直しで古い名前に戻らない）", async () => {
      await page.locator(`[data-testid="moyai-row"][data-plan="${planId}"]`).getByTestId("moyai-next").click();
      await expect(page.getByTestId("plan-name")).toHaveText(NEW, { timeout: 30_000 });
      const r = await call(c, "chart_rows", { limit: 1 });
      expect(r.source).toBe("working");
      // 作り直しを待っても戻らない
      await page.waitForTimeout(1500);
      await expect(page.getByTestId("plan-name")).toHaveText(NEW);
    });
  } finally {
    await c.close();
  }
});
