// 星取の案（chart_propose の stars）を、この PC の Chrome と Edge で端から端まで通す：
// 見本の計画を HOSHITORI で開く → AI（試験の台本が MCP の SDK で代わる）が chart_rows で機器の作業の行を読み、足す案を置く
// → 星取表のそのセルに朱の破線の円。詳しくに「計画の追加（未確定）」と「| 確定のシートで見る」→ 確定のシートでその行（「計画の追加　機器 › 作業」）を確定 → 実線になる
// → AI が今ある計画の星取に削除の案を置く → 今の星取は墨のまま朱の斜線を重ねる → 人が確定 → 星取が消える（docs/screens.md 3.2）。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, callTool as call, mcpClient, shot, sideTab, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

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

/** 確定のシートで、その種類に切り替え、行（題で選ぶ）の「確定」を押す（open が false なら、もう確定のシートが開いている） */
async function acceptRow(page: Page, kind: RegExp, text: RegExp, open = true): Promise<void> {
  if (open) await page.getByTestId("sheet-decisions").click();
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

test("AI が星取の追加・削除の案を置き、星取表に朱の破線の円・斜線が出て、人が確定のシートで確定すると実線になる・消える", async ({ page }, info) => {
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
      await expect(page.getByTestId("legend-star")).toHaveText(/追加.*／.*削除/);
      await page.screenshot({ path: shot(`star-proposal-add-${tag}`) });
    });

    const work = plan.works.find((w: any) => w.workKey === add!.workKey)!.kind as string;
    await test.step("人：星取を選ぶと詳しくに「計画の追加（未確定）」「2028 年度　作業」「出どころ　会話の回答」。「| 確定のシートで見る」でその行が選ばれる", async () => {
      await sideTab(page, "source");
      await cell(add!.nodeKey, add!.fy).click();
      const side = page.getByTestId("star-proposal");
      await expect(side).toContainText("計画の追加（未確定）");
      await expect(side).toContainText(`${add!.fy} 年度　${work}`);
      await expect(side).toContainText("出どころ　会話の回答");
      await side.getByTestId("star-see-in-decisions").click();
      await expect(page.getByTestId("decisions-sheet")).toBeVisible();
      const row = page.locator('[data-testid="pending-row"][data-star-kind="planAdd"]');
      await expect(row).toHaveAttribute("aria-selected", "true");
      await expect(row.getByTestId("star-title")).toHaveText(/^計画の追加　/);
      await expect(row.getByTestId("star-title")).toContainText(` › ${work}`);
      await expect(row.getByTestId("star-years")).toHaveText(`${add!.fy} 年度`);
      await expect(row).toContainText("- 会話の回答");
      await expect(row.getByTestId("pending-count")).toHaveText("1");
      await page.screenshot({ path: shot(`star-proposal-decisions-${tag}`) });
    });

    await test.step("人：確定のシートの「計画の追加」の行を確定 → 実線（破線の円が消え、計画の星取が残る）", async () => {
      await acceptRow(page, /^会話の回答/, /^計画の追加/, false);
      await expect(cell(add!.nodeKey, add!.fy)).not.toHaveClass(/moyai-mark-proposal/);
      await expect(cell(add!.nodeKey, add!.fy).locator("[data-mark]")).toHaveAttribute("data-mark", "plan");
    });

    const rm = pickRemove(add!.nodeKey);
    expect(rm, "計画の星取が 1 つだけの年度のある、描かれた機器").toBeTruthy();
    await test.step("AI：今ある計画の星取に削除の案を置く → 今の星取は墨のまま、朱の斜線を重ねる", async () => {
      const rows = await call(c, "chart_rows", { rowRef: `n:${rm!.nodeKey}` });
      const r = await call(c, "chart_propose", {
        basedOnVersion: rows.version,
        basis: "利用者が会話で、この年度の計画は取りやめたと言った",
        author: "ai_relayed_human",
        stars: [{ op: "remove", rowRef: `w:${rm!.workKey}`, value: "plan", fiscalYear: rm!.fy }],
      });
      expect(r.stars).toEqual([expect.objectContaining({ op: "remove", placed: true, details: 1 })]);
      await expect(cell(rm!.nodeKey, rm!.fy)).toHaveClass(/moyai-mark-strike/);
      await expect(cell(rm!.nodeKey, rm!.fy)).not.toHaveClass(/moyai-mark-proposal/);
      await expect(cell(rm!.nodeKey, rm!.fy).locator("[data-mark]")).toHaveAttribute("data-strike", "true");
      await expect(cell(rm!.nodeKey, rm!.fy).locator("[data-mark]")).toHaveAttribute("data-mark", "plan");
      expect(await cell(rm!.nodeKey, rm!.fy).getAttribute("aria-label")).toContain("未確定の削除");
      await expect(page.getByTestId("legend-star")).toBeVisible();
      await page.screenshot({ path: shot(`star-proposal-remove-${tag}`) });
      await page.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => (el.scrollLeft = el.scrollWidth));
      await page.waitForTimeout(300);
      const box = await cell(rm!.nodeKey, rm!.fy).boundingBox();
      if (box) await page.screenshot({ path: shot(`star-proposal-remove-cell-${tag}`), clip: { x: Math.max(0, box.x - 200), y: box.y - 40, width: box.width + 240, height: box.height + 80 } });
    });

    await test.step("共通台帳：まとめたセルに削除の案があれば、朱の破線の円を重ねる（斜線は施設台帳だけ）", async () => {
      await page.getByTestId("rows-mode").getByText("共通台帳").click();
      const col = grid.locator(`.ag-cell[col-id="fy${rm!.fy}"]`);
      await expect(col.locator('[data-ring="true"]').first()).toBeAttached();
      await expect(grid.locator(".moyai-mark-strike")).toHaveCount(0);
      expect(await grid.locator(".moyai-mark-ring").count()).toBeGreaterThan(0);
      await page.screenshot({ path: shot(`star-proposal-common-${tag}`) });
      await page.getByTestId("rows-mode").getByText("施設台帳").click();
      await expect(cell(rm!.nodeKey, rm!.fy)).toHaveClass(/moyai-mark-strike/);
    });

    await test.step("人：確定のシートの「計画の削除」の行を確定 → 星取が消える", async () => {
      await acceptRow(page, /^会話の回答/, /^計画の削除/);
      await expect(cell(rm!.nodeKey, rm!.fy)).not.toHaveClass(/moyai-mark-strike/);
      await expect(cell(rm!.nodeKey, rm!.fy).locator("[data-mark]")).toHaveCount(0);
      await expect(page.getByTestId("legend-star")).toHaveCount(0);
    });

    // 実績の追加：基準日の年度（今日）までの、星取の無い年度
    const nowFy = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const act = (() => {
      for (const n of shown) {
        if (n === add!.nodeKey || n === rm!.nodeKey) continue;
        const { works, ds } = byNode(n);
        if (works.length === 0) continue;
        for (let fy = Math.min(hi, nowFy); fy >= lo; fy--) if (!ds.some((d: any) => d.fiscalYear === fy)) return { nodeKey: n, workKey: works[0]!, fy };
      }
      return null;
    })();
    expect(act, "星取の無い過去の年度のある、描かれた機器").toBeTruthy();
    await test.step("AI：利用者の言葉で実績の追加を置く → 朱の破線の円の中に朱の点。人が却下すると消える", async () => {
      const rows = await call(c, "chart_rows", { rowRef: `n:${act!.nodeKey}` });
      const r = await call(c, "chart_propose", {
        basedOnVersion: rows.version,
        basis: "利用者が会話で、この年度に実施したと言った",
        author: "ai_relayed_human",
        stars: [{ op: "add", rowRef: `w:${act!.workKey}`, value: "actual", fiscalYear: act!.fy }],
      });
      expect(r.stars).toEqual([expect.objectContaining({ op: "add", placed: true })]);
      const c0 = cell(act!.nodeKey, act!.fy);
      await expect(c0).toHaveClass(/moyai-mark-proposal/);
      await expect(c0.locator("[data-mark]")).toHaveAttribute("data-mark", "actual");
      const look = await c0.locator("[data-mark]").evaluate((el) => {
        const b = getComputedStyle(el, "::before");
        return { image: b.backgroundImage, border: b.borderTopStyle, width: b.width };
      });
      expect(look.image).toContain("radial-gradient");
      expect(look.border).toBe("dashed");
      expect(look.width).toBe("10px");
      const box = await c0.boundingBox();
      if (box) await page.screenshot({ path: shot(`star-proposal-actual-cell-${tag}`), clip: { x: Math.max(0, box.x - 120), y: box.y - 40, width: box.width + 160, height: box.height + 80 } });
      // 却下：確定のシートの「実績の追加」の行の「| 却下」→ 判断の理由 →「却下」
      await page.getByTestId("sheet-decisions").click();
      const kinds = page.getByTestId("decisions-kind").locator("button").filter({ hasText: /^会話の回答/ });
      if ((await kinds.count()) > 0) await kinds.first().click();
      await page.getByTestId("decisions-reason").fill(REASON);
      const row = page.locator('[data-testid="pending-row"][data-accepted="false"]').filter({ hasText: /^実績の追加/ });
      await row.getByTestId("pending-reject").click();
      await page.getByTestId("reject-reason").fill("利用者が取り消した（試験の台本）");
      await page.getByTestId("star-reject-confirm").click();
      await expect(page.locator('[data-testid="pending-row"][data-accepted="false"]').filter({ hasText: /^実績の追加/ })).toHaveCount(0);
      await page.getByTestId("sheet-chart").click();
      await expect(cell(act!.nodeKey, act!.fy).locator("[data-mark]")).toHaveCount(0);
    });
  } finally {
    await c.close();
  }
});
