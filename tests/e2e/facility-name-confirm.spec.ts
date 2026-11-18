// 施設の名前を変える（2026-11-18、運営者が M-PC3 で見つけた不具合）：Claude が chart_propose の facilityName で案を置く → 確定のシートに並ぶ →
// 人が受けて署名して確定 → 新しい版の施設名・MOYAI のトップの行の名前・HOSHITORI の見出しが新しい名前になる。
// 【架空】の施設は【架空】の印を残したまま、名前の残りを変えられる。
// 署名して確定したら、HOSHITORI のまま確定した版を見るだけで出す（トップへ戻らない・次の版を開かない。出力・共有はこの版で使える。
// 次の版は人が「＋ 次の版」を押したときだけ。運営者の判断 2026-11-18 夜）。
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

test("Claude の名前の案を人が受けて署名すると、版・トップ・見出しが新しい名前になり、確定のあとは確定した版を見るだけで出し続ける", async ({ page }, info) => {
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
      const loaded = page.waitForEvent("load");
      await page.getByTestId("confirm-close").click();
      await loaded;
    });

    await test.step("確定のあとは HOSHITORI のまま、確定した第 1 版を見るだけで出す（トップへ戻らない・次の版を開かない）", async () => {
      await expect(page.getByTestId("merge-state")).toHaveText("確定（見るだけ）", { timeout: 30_000 });
      await expect(page.getByTestId("merge-version")).toHaveText("第 1 版");
      await expect(page.getByTestId("plan-name")).toHaveText(NEW);
      await expect(page.getByTestId("moyai-top")).toHaveCount(0);
      await expect(page.locator(".ag-row").first()).toBeVisible();
      await expect(page.getByTestId("merge-next")).toBeVisible();
      // 見るだけ：AI の案は置けない（星も名前も動かせない）。行は保管先の確定した版から読む
      const cw: any = await c.callTool({ name: "chart_propose", arguments: { basedOnVersion: 0, basis: "試し", author: "ai_relayed_human", facilityName: "【架空】動かない名前" } });
      expect(cw.isError).toBe(true);
      expect(JSON.stringify(cw.content)).toContain("read only");
      const r = await call(c, "chart_rows", { limit: 1 });
      expect(r.source).toBe("confirmed");
      expect(r.confirmed.facilityName).toBe(NEW);
      await page.screenshot({ path: shot(`name-confirmed-view-${tag}`) });
    });

    await test.step("確定した版のまま、出力のシートで Excel を出せ、共有のシートが開く", async () => {
      await page.getByTestId("sheet-export").click();
      await expect(page.getByTestId("export-excel")).toBeEnabled();
      await Promise.all([page.waitForEvent("download"), page.getByTestId("export-excel").click()]);
      await expect(page.getByTestId("export-saved")).toBeVisible();
      await page.getByTestId("sheet-share").click();
      await expect(page.getByTestId("checkpoint-page")).toBeVisible();
      await page.getByTestId("sheet-chart").click();
    });

    await test.step("読み込み直しても、確定した版を見るだけのまま（勝手に次の版にならない）。トップの行に「作業中」は無い", async () => {
      await page.reload();
      await expect(page.getByTestId("merge-state")).toHaveText("確定（見るだけ）", { timeout: 30_000 });
      await expect(page.getByTestId("merge-version")).toHaveText("第 1 版");
      const back = page.url();
      await page.evaluate(() => (location.hash = "#/"));
      const row = page.locator(`[data-testid="moyai-row"][data-plan="${planId}"]`);
      await expect(row).toContainText(NEW);
      await expect(row).not.toContainText(OLD);
      await expect(row.getByTestId("moyai-version")).toContainText("第 1 版");
      await expect(row.getByTestId("moyai-work")).toHaveCount(0);
      await page.screenshot({ path: shot(`name-top-${tag}`) });
      await page.goto(back);
      await expect(page.getByTestId("merge-state")).toHaveText("確定（見るだけ）", { timeout: 30_000 });
    });

    await test.step("「＋ 次の版」を押して初めて第 2 版が開く。見出しも新しい名前のまま（作り直しで古い名前に戻らない）", async () => {
      await page.getByTestId("merge-next").click();
      await expect(page.getByTestId("merge-state")).toHaveText("編集中", { timeout: 30_000 });
      await expect(page.getByTestId("merge-version")).toHaveText("第 2 版");
      await expect(page.getByTestId("plan-name")).toHaveText(NEW);
      const r = await call(c, "chart_rows", { limit: 1 });
      expect(r.source).toBe("working");
      await page.waitForTimeout(1500);
      await expect(page.getByTestId("plan-name")).toHaveText(NEW);
    });

    await test.step("未確定の数：次の版で案を 1 つ置くと HOSHITORI は 1。受けると、HOSHITORI もトップも 0（前の版で受けた決定は数えない）", async () => {
      const NEXT = "【架空】みなと第二清掃工場";
      const cw = await call(c, "intake_survey", { part: "crosswalk" });
      await call(c, "chart_propose", { basedOnVersion: cw.crosswalk.version, basis: "利用者がもう一度名前を直してと言った", author: "ai_relayed_human", facilityName: NEXT });
      await expect(page.getByTestId("sheet-decisions").locator(".moyai-sheet-n")).toHaveText("1");
      expect(await acceptDecisions(page, "名前は利用者に確かめた")).toBe(1);
      await expect(page.getByTestId("sheet-decisions").locator(".moyai-sheet-n")).toHaveCount(0);
      // 作業中の写しを書き終えてからトップを見る：「作業中」で、未確定は 0（前は前の版で受けた決定まで数えていた）
      await page.waitForTimeout(2500);
      await page.evaluate(() => (location.hash = "#/"));
      const work = page.locator(`[data-testid="moyai-row"][data-plan="${planId}"]`).getByTestId("moyai-work");
      await expect(work).toHaveAttribute("data-open", "0");
      await expect(work).toHaveText("作業中");
      await page.screenshot({ path: shot(`name-top-open-${tag}`) });
    });
  } finally {
    await c.close();
  }
});

test("同じ版を「＋ 次の版」で 2 回開いても、戻し終えるまで待って作り直す（2 回目に止め札が残って作り直しが failed になっていた）", async ({ page }) => {
  test.setTimeout(180_000);
  const c = await connect(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose"]);
  try {
    // 前の台本の施設（第 1 版が確定している）を、トップの「＋ 次の版」から 2 回続けて開き、すぐに作り直す
    for (let k = 0; k < 2; k++) {
      await page.goto(`${bridge.base}/#/`);
      await page.getByTestId("moyai-next").first().click();
      // 開いた直後（資料を戻し終える前）に作り直しを頼む（見出しに次の版が出たら。資料はまだ戻している途中）
      await expect(page.getByTestId("merge-version")).toHaveText("第 2 版", { timeout: 30_000 });
      expect((await call(c, "intake_compose")).started).toBe(true);
      let state = "running";
      let message: string | null = null;
      for (let i = 0; i < 300 && state === "running"; i++) {
        const s = await call(c, "intake_survey", { part: "compose" });
        state = s.compose.state;
        message = s.compose.message;
        if (state === "running") await page.waitForTimeout(200);
      }
      expect(state, `${k + 1} 回目：${message}`).toBe("done");
      await expect(page.getByTestId("merge-version")).toHaveText("第 2 版");
    }
  } finally {
    await c.close();
  }
});

