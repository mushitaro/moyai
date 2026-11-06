// 星取の案（chart_propose の stars）を、この PC の Chrome と Edge で端から端まで通す：
// 見本の計画を HOSHITORI で開く → AI（試験の台本が MCP の SDK で代わる）が chart_rows で機器の作業の行を読み、足す案を置く
// → 星取表のそのセルに朱の破線の円 → 人（試験の台本が押した）が確定のシートで確定 → 実線になる
// → AI が今ある計画の星取に消す案を置く → 今の星取に朱の破線の円を重ねる → 人が確定 → 星取が消える。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, callTool as call, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-star-proposal-"));
  bridge = await startBuiltBridge("moyai-e2e-star-proposal-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

const REASON = "試験の台本が押した（星取の案を確定した）";

/** 確定のシートで、その種類に切り替え、行（文で選ぶ）の「確定」を押す */
async function acceptRow(page: Page, kind: RegExp, text: RegExp): Promise<void> {
  await page.getByTestId("sheet-decisions").click();
  await expect(page.getByTestId("decisions-sheet")).toBeVisible();
  const kinds = page.getByTestId("decisions-kind").locator("button").filter({ hasText: kind });
  if ((await kinds.count()) > 0) await kinds.first().click();
  await page.getByTestId("decisions-reason").fill(REASON);
  const row = page.locator('[data-testid="pending-row"][data-accepted="false"]').filter({ hasText: text });
  await expect(row).toHaveCount(1);
  await row.getByTestId("pending-accept").click();
  await expect(page.locator('[data-testid="pending-row"][data-accepted="false"]').filter({ hasText: text })).toHaveCount(0);
  await page.getByTestId("sheet-chart").click();
}

test("AI が星取の足す案・消す案を置き、星取表に朱の破線の円が出て、人が確定のシートで確定すると実線になる・消える", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");
  const c = await mcpClient(bridge.stateDir, ["chart_rows", "chart_propose"]);
  const grid = page.getByTestId("chart-grid");
  const plan = DEV_PLANS["fictional-1"]();
  try {
    await test.step("人：設定で置き場所と呼び名。見本の計画を HOSHITORI で開く", async () => {
      await page.goto(`${bridge.base}/#/settings`);
      await page.getByTestId("root-change").click();
      await page.getByTestId("root-input").fill(root);
      await page.getByTestId("name-change").click();
      await page.getByTestId("name-input").fill(E2E_NAME);
      await page.getByTestId("settings-save").click();
      await expect(page.getByTestId("current-name")).toHaveText(E2E_NAME);
      const body = JSON.stringify(plan);
      await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
      await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
      await expect(page.locator(".ag-row").first()).toBeVisible();
    });

    // 表に描かれている機器の行（n:…）から、星取の無い年度（足す案）と、計画の星取が 1 つだけの年度（消す案）を選ぶ
    const shown = new Set(
      (await grid.locator('.ag-row[row-id^="n:"]').evaluateAll((els) => els.map((e) => e.getAttribute("row-id") ?? ""))).map((id) => id.slice(2)),
    );
    const years = plan.details.map((d: any) => d.fiscalYear as number);
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    const byNode = (nodeKey: string) => {
      const works = plan.works.filter((w: any) => w.targets.includes(nodeKey)).map((w: any) => w.workKey as string);
      const ds = plan.details.filter((d: any) => works.includes(d.workKey));
      return { works, ds };
    };
    const pickAdd = () => {
      for (const n of shown) {
        const { works, ds } = byNode(n);
        if (works.length === 0) continue;
        for (let fy = hi; fy >= lo; fy--) if (!ds.some((d: any) => d.fiscalYear === fy)) return { nodeKey: n, workKey: works[0]!, fy };
      }
      return null;
    };
    const pickRemove = (skip: string) => {
      for (const n of shown) {
        if (n === skip) continue;
        const { ds } = byNode(n);
        for (let fy = hi; fy >= lo; fy--) {
          const at = ds.filter((d: any) => d.fiscalYear === fy);
          if (at.length === 1 && at[0]!.planOrActual === "plan") return { nodeKey: n, workKey: at[0]!.workKey as string, fy };
        }
      }
      return null;
    };
    const add = pickAdd();
    expect(add, "星取の無い年度のある、描かれた機器").toBeTruthy();
    const cell = (nodeKey: string, fy: number) => grid.locator(`.ag-row[row-id="n:${nodeKey}"] .ag-cell[col-id="fy${fy}"]`);

    await test.step("AI：chart_rows で機器の作業の行を読み、利用者の言葉から足す案（計画）を置く → 朱の破線の円", async () => {
      const rows = await call(c, "chart_rows", { rowRef: `n:${add!.nodeKey}` });
      const ref = rows.rows.map((r: any) => r.rowRef).find((r: string) => r === `w:${add!.workKey}`);
      expect(ref, "作業の行の id").toBeTruthy();
      const r = await call(c, "chart_propose", {
        basedOnVersion: rows.version,
        basis: "利用者が会話で、この年度に計画すると言った",
        author: "ai_relayed_human",
        stars: [{ op: "add", rowRef: ref, value: "plan", fiscalYear: add!.fy }],
      });
      expect(r.stars).toEqual([expect.objectContaining({ op: "add", placed: true })]);
      await expect(cell(add!.nodeKey, add!.fy)).toHaveClass(/moyai-mark-proposal/);
      expect(await cell(add!.nodeKey, add!.fy).getAttribute("aria-label")).toContain("未確定の案");
      await expect(page.getByTestId("legend-proposal")).toBeVisible();
      await page.screenshot({ path: shot(`star-proposal-add-${tag}`) });
    });

    await test.step("人：確定のシートの「追加」の行を確定 → 実線（破線の円が消え、計画の星取が残る）", async () => {
      await acceptRow(page, /^会話の回答/, /^追加/);
      await expect(cell(add!.nodeKey, add!.fy)).not.toHaveClass(/moyai-mark-proposal/);
      await expect(cell(add!.nodeKey, add!.fy).locator("[data-mark]")).toHaveAttribute("data-mark", "plan");
    });

    const rm = pickRemove(add!.nodeKey);
    expect(rm, "計画の星取が 1 つだけの年度のある、描かれた機器").toBeTruthy();
    await test.step("AI：今ある計画の星取に消す案を置く → 今の星取に朱の破線の円を重ねる（星取はまだ残る）", async () => {
      const rows = await call(c, "chart_rows", { rowRef: `n:${rm!.nodeKey}` });
      const r = await call(c, "chart_propose", {
        basedOnVersion: rows.version,
        basis: "利用者が会話で、この年度の計画は取りやめたと言った",
        author: "ai_relayed_human",
        stars: [{ op: "remove", rowRef: `w:${rm!.workKey}`, value: "plan", fiscalYear: rm!.fy }],
      });
      expect(r.stars).toEqual([expect.objectContaining({ op: "remove", placed: true, details: 1 })]);
      await expect(cell(rm!.nodeKey, rm!.fy)).toHaveClass(/moyai-mark-ring/);
      await expect(cell(rm!.nodeKey, rm!.fy).locator("[data-mark]")).toHaveAttribute("data-ring", "true");
      expect(await cell(rm!.nodeKey, rm!.fy).getAttribute("aria-label")).toContain("未確定の削除");
      await expect(page.getByTestId("legend-removal")).toBeVisible();
      await page.screenshot({ path: shot(`star-proposal-remove-${tag}`) });
    });

    await test.step("人：確定のシートの「削除」の行を確定 → 星取が消える", async () => {
      await acceptRow(page, /^会話の回答/, /^削除/);
      await expect(cell(rm!.nodeKey, rm!.fy)).not.toHaveClass(/moyai-mark-ring/);
      await expect(cell(rm!.nodeKey, rm!.fy).locator("[data-mark]")).toHaveCount(0);
      await expect(page.getByTestId("legend-removal")).toHaveCount(0);
    });
  } finally {
    await c.close();
  }
});
