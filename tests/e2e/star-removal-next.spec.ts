// 星取の削除を版に残す（Architect の 70）を、この PC の Chrome と Edge で端から端まで通す：
// 人が資料を落とし、AI が取り込んで第 1 版に署名 → AI が利用者の言葉で、資料から読んだ実績の削除の案を置く → 人が確定のシートで確定し、第 2 版に署名
// → 版の記録の署名の内側に remove:<明細の鍵>・理由・作者 → トップの「＋ 次の版」で資料と決定が戻り、作り直しても、その実績は戻らない。
// 先に npm run build を走らせておく。置き場所は一時のフォルダに作る。
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_NAME, acceptDecisions, callTool as call, mcpClient, openIntakeAndDrop, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】星取の削除を残す";
const REASON = "試験の台本が押した（利用者が二重の記録と言った実績を消す）";

let bridge: StartedBridge;
let work = "";
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-star-removal-");
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-star-removal-work-"));
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** 機器の作業の行（w:…）のうち、年度 fy に ● のあるもの（無ければ null） */
const actualYear = (cells: Record<string, string>): number | null => {
  const ys = Object.entries(cells)
    .filter(([k, v]) => /^\d{4} 年度$/.test(k) && v === "●")
    .map(([k]) => Number(k.slice(0, 4)));
  return ys.length > 0 ? Math.max(...ys) : null;
};

test("資料から読んだ実績を消して確定し、「＋ 次の版」で作り直しても、その実績は戻らない。版の記録に理由と作者がある", async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "chart_propose"]);
  try {
    await test.step("人：設定で置き場所と呼び名を選び、資料を落とす。AI が既定の答えで取り込む", async () => {
      await page.goto(`${bridge.base}/#/settings`);
      await page.getByTestId("root-change").click();
      await page.getByTestId("root-input").fill(root);
      await page.getByTestId("name-change").click();
      await page.getByTestId("name-input").fill(E2E_NAME);
      await page.getByTestId("settings-save").click();
      await expect(page.getByTestId("current-name")).toHaveText(E2E_NAME);
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
      let state = "running";
      for (let i = 0; i < 100 && state === "running"; i++) {
        state = (await call(c, "intake_survey", { part: "compose" })).compose.state;
        if (state === "running") await page.waitForTimeout(100);
      }
      expect(state).toBe("done");
    });

    await test.step("人：決定を受けて第 1 版に署名する", async () => {
      await acceptDecisions(page, "試験の台本が押した（チャットの答えを画面で受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("第 1 版（e2e）");
      await signInDialog(page);
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
      await page.getByTestId("confirm-close").click();
    });

    // 実績（●）のある作業の行を 1 つ選ぶ（資料から読んだもの）
    let pick: { node: string; workRef: string; fy: number } | null = null;
    await test.step("AI：chart_rows で機器の作業の行を読み、資料から読んだ実績を 1 つ選ぶ", async () => {
      const rows = await call(c, "chart_rows", { limit: 200 });
      for (const r of rows.rows as { rowRef: string }[]) {
        if (!r.rowRef.startsWith("n:")) continue;
        const ws = await call(c, "chart_rows", { rowRef: r.rowRef });
        for (const w of ws.rows as { rowRef: string; cells: Record<string, string> }[]) {
          const fy = actualYear(w.cells);
          if (fy !== null) {
            pick = { node: r.rowRef, workRef: w.rowRef, fy };
            break;
          }
        }
        if (pick) break;
      }
      expect(pick, "実績のある作業の行").toBeTruthy();
    });

    await test.step("AI：利用者の言葉で実績の削除を置く → 人が確定のシートで確定し、第 2 版に署名する", async () => {
      const rows = await call(c, "chart_rows", { rowRef: pick!.node });
      const r = await call(c, "chart_propose", {
        basedOnVersion: rows.version,
        basis: "利用者が会話で、この年度の実績は二重の記録だと言った",
        author: "ai_relayed_human",
        stars: [{ op: "remove", rowRef: pick!.workRef, value: "actual", fiscalYear: pick!.fy }],
      });
      expect(r.stars).toEqual([expect.objectContaining({ op: "remove", placed: true })]);
      await page.getByTestId("sheet-decisions").click();
      const kinds = page.getByTestId("decisions-kind").locator("button").filter({ hasText: /^会話の回答/ });
      if ((await kinds.count()) > 0) await kinds.first().click();
      await page.getByTestId("decisions-reason").fill(REASON);
      const row = page.locator('[data-testid="pending-row"][data-accepted="false"]').filter({ hasText: /^実績の削除/ });
      await expect(row).toHaveCount(1);
      await row.getByTestId("pending-accept").click();
      await expect(page.locator('[data-testid="pending-row"][data-accepted="false"]').filter({ hasText: /^実績の削除/ })).toHaveCount(0);
      // 削除を確定すると、AI が読む行からもその実績が消える
      const after = await call(c, "chart_rows", { rowRef: pick!.node });
      expect(after.rows.find((w: any) => w.rowRef === pick!.workRef).cells[`${pick!.fy} 年度`]).not.toBe("●");
      // 同じタブで続けて次の版を作ると、取り込みの決定（会話の回答）がまた未確定に並ぶ（星取の案とは別。Dev に知らせる）ので、受け直す
      await acceptDecisions(page, "試験の台本が押した（チャットの答えを画面で受けた）");
      await page.getByTestId("confirm-open").click({ timeout: 20_000 });
      await page.getByTestId("confirm-reason").fill("実績の誤りを消す（e2e）");
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText("第 2 版に署名しました");
      await page.getByTestId("confirm-close").click();
      const plans = readdirSync(join(root, "plans"));
      const rec = JSON.parse(readFileSync(join(root, "plans", plans[0]!, "versions", "000002.json"), "utf8"));
      const removed = rec.acceptances.filter((a: any) => String(a.id).startsWith("remove:"));
      expect(removed.length).toBeGreaterThan(0);
      for (const a of removed) expect(a).toMatchObject({ reason: REASON, author: "human" });
    });

    await test.step("人：トップの「＋ 次の版」で資料と決定が戻り、作り直しても、消した実績は戻らない", async () => {
      await page.evaluate(() => (location.hash = "#/"));
      await page.getByTestId("moyai-next").first().click();
      await expect(page.getByTestId("compose")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("sheet-file").first().click();
      await expect(page.getByTestId("compose")).toBeEnabled();
      await page.getByTestId("compose").click();
      await expect(page.getByTestId("composed")).toBeVisible({ timeout: 60_000 });
      const again = await call(c, "chart_rows", { rowRef: pick!.node });
      const w = again.rows.find((x: any) => x.rowRef === pick!.workRef);
      expect(w, "作り直した計画にも同じ作業がある").toBeTruthy();
      expect(w.cells[`${pick!.fy} 年度`]).not.toBe("●");
      await page.screenshot({ path: shot(`star-removal-next-${tag}`), fullPage: true });
    });
  } finally {
    await c.close();
  }
});
