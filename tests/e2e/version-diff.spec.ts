// 版どうしの差（docs/screens.md 3.2、P2 の 1）を、この PC の Chrome と Edge で通す：
// 見本の計画を第 1 版として署名して確定 → 見出しに「比べる版　第 1 版」、まだ何も変えていないので変わった印は無い
// → AI（試験の台本が MCP の SDK で代わる）が chart_propose で周期の案を置く → 第 1 版から変わったセルが朱になり、凡例に「第 1 版から変わった」
// → 人が決定のシートで受けて第 2 版に署名 → 比べる版は第 2 版になり、変わった印は無くなる。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, callTool as call, mcpClient, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const PASS = "架空の合言葉 版どうしの差";

let bridge: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-version-diff-"));
  bridge = await startBuiltBridge("moyai-e2e-version-diff-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("第 1 版と比べて、変わった印を朱で描き、第 2 版に署名すると比べる版が替わる", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");
  const c = await mcpClient(bridge.stateDir, ["chart_propose", "intake_survey"]);
  const grid = page.getByTestId("chart-grid");
  try {
    await test.step("人：設定で置き場所と呼び名。見本の計画を MERGE で開き、決定を受けて第 1 版に署名する", async () => {
      await page.goto(`${bridge.base}/#/settings`);
      await page.getByTestId("root-input").fill(root);
      await page.getByTestId("name-input").fill(E2E_NAME);
      await page.getByTestId("settings-save").click();
      await expect(page.getByTestId("current-name")).toHaveText(E2E_NAME);
      const body = JSON.stringify(DEV_PLANS["fictional-1"]());
      await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
      await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
      await expect(page.locator(".ag-row").first()).toBeVisible();
      // まだ保管先に版が無いので、比べる版は無い
      await expect(page.getByTestId("merge-compare")).toHaveCount(0);
      await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("見本の計画を第 1 版にする（e2e）");
      await signInDialog(page, PASS);
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
      await page.keyboard.press("Escape");
    });

    await test.step("比べる版は第 1 版。まだ何も変えていないので、変わった印は無い", async () => {
      await page.getByTestId("sheet-chart").click();
      await expect(page.getByTestId("merge-compare")).toHaveAttribute("data-version", "1");
      await expect(page.getByTestId("merge-compare")).toContainText("比べる版　第 1 版");
      // 確定したあとは、次の版を編集中（「確定済み」は古い版を見るだけで開いたときだけ）
      await expect(page.getByTestId("merge-turn")).toHaveText("編集の番 あなた");
      await expect(grid.locator(".moyai-mark-vchg")).toHaveCount(0);
      await expect(page.getByTestId("legend-changed-from")).toHaveAttribute("data-count", "0");
    });

    await test.step("AI：周期の案を置く → 第 1 版から変わったセルが朱になり、凡例に「第 1 版から変わった」", async () => {
      // 計画にある項目 × 作業の属性で、実施のある作業（周期の案はその作業の最後の実施から引く）
      const plan = DEV_PLANS["fictional-1"]();
      const pair = (() => {
        for (const w of plan.works) {
          if (!w.attribute || !plan.details.some((d: any) => d.workKey === w.workKey && d.planOrActual === "actual")) continue;
          const asset = plan.assets.find((x: any) => w.targets.includes(x.nodeKey) && x.commonItem);
          if (asset) return { commonItem: asset.commonItem as string, work: w.attribute as string };
        }
        return null;
      })();
      expect(pair, "実施のある作業がある").toBeTruthy();
      const version = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk.version;
      const rules = [{ when: [{ field: "assetNode.commonItem", op: "equals", values: [pair!.commonItem] }, { field: "work.attribute", op: "equals", values: [pair!.work] }], set: { field: "work.trigger", value: 1 }, reason: "毎年に" }];
      const r = await call(c, "chart_propose", { rules, basedOnVersion: version, basis: "試験の台本（版どうしの差）" });
      expect(r.matched).toBeGreaterThan(0);
      await expect(page.getByTestId("legend-changed-from")).toBeVisible();
      await expect(page.getByTestId("legend-changed-from")).toContainText("第 1 版から変わった");
      const n = Number(await page.getByTestId("legend-changed-from").getAttribute("data-count"));
      expect(n).toBeGreaterThan(0);
      // 変わったセルは朱（見えている列の中にあれば描かれる。無ければ右へ送る）
      if ((await grid.locator(".moyai-mark-vchg").count()) === 0) {
        await page.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => (el.scrollLeft = el.scrollWidth));
        await page.waitForTimeout(300);
      }
      await expect(grid.locator(".moyai-mark-vchg").first()).toBeVisible();
      expect(await grid.locator(".moyai-mark-vchg").first().getAttribute("aria-label")).toContain("第 1 版から変わった");
      await page.screenshot({ path: shot(`version-diff-${tag}`) });
    });

    await test.step("人：決定のシートで受けて第 2 版に署名 → 比べる版は第 2 版になり、変わった印は無くなる", async () => {
      await acceptDecisions(page, "試験の台本が押した（周期の案を受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("周期の案を入れて第 2 版にする（e2e）");
      await page.getByTestId("sign-passphrase").fill(PASS);
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText("第 2 版に署名しました");
      await page.keyboard.press("Escape");
      await page.getByTestId("sheet-chart").click();
      await expect(page.getByTestId("merge-compare")).toHaveAttribute("data-version", "2");
      await expect(page.getByTestId("legend-changed-from")).toHaveAttribute("data-count", "0");
      await expect(grid.locator(".moyai-mark-vchg")).toHaveCount(0);
    });

    await test.step("トップの版の印のメニュー：第 1 版を「開く」と見るだけ（確定できない）", async () => {
      await page.goto(`${bridge.base}/#/`);
      await page.locator('[data-testid="moyai-mark"][data-version="1"]').click();
      await page.getByTestId("mark-open").click();
      await expect(page.getByTestId("merge-version")).toHaveText("第 1 版");
      await expect(page.getByTestId("plan-name")).toBeVisible();
      await expect(page.getByTestId("confirm-open")).toBeDisabled();
      await expect(page.getByTestId("confirm-disabled-reason")).toContainText("保管先の古い版を見ています");
      await expect(page.getByTestId("merge-compare")).toHaveCount(0);
    });

    await test.step("「この版から次の版」：第 1 版の中身から第 3 版をつくる。第 2 版と比べ、第 2 版で足した印は「第 2 版の印」になる", async () => {
      await page.goto(`${bridge.base}/#/`);
      await page.locator('[data-testid="moyai-mark"][data-version="1"]').click();
      await page.getByTestId("mark-next").click();
      await expect(page.getByTestId("merge-version")).toHaveText("第 3 版");
      await expect(page.getByTestId("merge-notice")).toContainText("第 1 版の中身から");
      await expect(page.getByTestId("merge-compare")).toHaveAttribute("data-version", "2");
      await expect(page.getByTestId("legend-old")).toBeVisible();
      expect(Number(await page.getByTestId("legend-old").getAttribute("data-count"))).toBeGreaterThan(0);
      await page.screenshot({ path: shot(`version-diff-from-old-${tag}`) });
    });
  } finally {
    await c.close();
  }
});
