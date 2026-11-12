// 端から端まで：ビルドした橋渡し（dist/cli.js start）と、この PC の Chrome・Edge の作業画面のタブと、
// 本物の中継（dist/cli.js mcp。標準入出力の MCP）を、MCP のクライアントでつなぐ。
// 人が資料を画面に落とし、AI が intake_survey → intake_settle → intake_compose → intake_survey → chart_rows を呼ぶ。
// 先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { callTool as call, chooseRoot, mcpClient as connect, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
let root = "";
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-mcp-");
  root = mkdtempSync(join(tmpdir(), "moyai-e2e-mcp-root-"));
});
test.afterAll(() => {
  bridge?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

const mcpClient = (stateDir: string) => connect(stateDir, ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "screen_set", "intake_add_files"]);

test("AI が MCP で取り込みを最後まで動かし、星取表の行を読む", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(120_000);
  const c = await mcpClient(bridge.stateDir);
  try {
    await test.step("作業画面が開く前は「作業画面が開いていません」", async () => {
      const r: any = await c.callTool({ name: "intake_survey", arguments: {} });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain("作業画面が開いていません");
    });

    await test.step("人が保存先を選び、資料を画面に落とす", async () => {
      // 確定のシートは、保存先の版の履歴（受けた決定）を読んでから決定を並べる。Documents に頼らず一時のフォルダを選ぶ
      await chooseRoot(page, bridge.base, root);
      await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場（AI）");
    });

    let firstQuestions = 0;
    await test.step("intake_survey：要約と、選択肢つきの質問", async () => {
      const s = await call(c, "intake_survey");
      expect(s.files).toHaveLength(3);
      expect(s.unresolvedCells).toBeGreaterThan(0);
      expect(s.questions.length).toBeGreaterThan(0);
      firstQuestions = s.questions.length;
      for (const q of s.questions) expect(q.valueKind === "number" || q.options.length > 0).toBe(true);
    });

    await test.step("intake_settle：出していない答えは断られ、何も置かれない", async () => {
      const s = await call(c, "intake_survey", { part: "questions" });
      const q = s.questions.find((x: any) => x.valueKind === "option");
      const r: any = await c.callTool({
        name: "intake_settle",
        arguments: { decisions: [{ questionId: q.questionId, answer: "above", author: "ai", reason: "見本" }] },
      });
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain("選択肢");
    });

    await test.step("intake_settle：利用者がチャットで既定の答えでよいと言ったものを置く（質問が無くなるまで）", async () => {
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        const decisions = s.questions.map((q: any) => ({
          questionId: q.questionId,
          answer: q.defaultAnswer,
          author: "ai_relayed_human",
          reason: "利用者がチャットで、既定の答えでよいと答えた",
        }));
        const r = await call(c, "intake_settle", { decisions });
        expect(r.unresolved).toBeGreaterThanOrEqual(0);
      }
      expect(firstQuestions).toBeGreaterThan(0);
      // 画面でも決まる：横の板の質問と「未回答 n」が消え、資料の未確定のセルが無くなり、第 1 版をつくれる
      // （答えの作者は、第 1 版をつくったあとの確定のシートで見る。資料のシートの決定の一覧と AI の作業の記録は置かない。docs/screens.md 3.3）
      await expect(page.getByTestId("question")).toHaveCount(0);
      await expect(page.getByTestId("side-open")).toHaveCount(0);
      await expect(page.locator('[data-testid="source-tab"] [data-testid="sheet-grid"] td[data-s="unresolved"]')).toHaveCount(0);
      await expect(page.getByTestId("compose")).toBeEnabled();
    });

    await test.step("intake_compose は作り始めた印だけを返し、結果は次の intake_survey で返る", async () => {
      const t0 = Date.now();
      const started = await call(c, "intake_compose");
      expect(started.started).toBe(true);
      expect(Date.now() - t0).toBeLessThan(20_000);
      let state = "running";
      let message: string | null = null;
      for (let i = 0; i < 50 && state === "running"; i++) {
        const s = await call(c, "intake_survey", { part: "compose" });
        state = s.compose.state;
        message = s.compose.message;
        if (state === "running") await page.waitForTimeout(100);
      }
      expect(state, String(message)).toBe("done");
      // 知らせの箱は出さない。つくった人は資料のシートの印（data-compose-by）で見る。資料を 1 つ選んだ形のまま（資料の選び。資料ごとのタブは無い）
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done");
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose-by", "ai");
      await expect(page.getByTestId("composed")).toHaveCount(0);
      await expect(page.getByTestId("source-pick")).toHaveAttribute("data-selected", "true");
      await expect(page.getByTestId("source-picker")).not.toHaveAttribute("data-file", "");
      await expect(page.getByTestId("sheet-file")).toHaveCount(0);
      await page.screenshot({ path: shot(`mcp-composed-${tag}`), fullPage: true });
      // 答えの作者は、確定のシートで「会話の回答」（AI がチャットでの人の答えとして置いたもの）だけ
      await page.getByTestId("sheet-decisions").click();
      await expect(page.getByTestId("decisions-kind")).toContainText("会話の回答");
      await expect(page.getByTestId("decisions-kind")).not.toContainText("Claude 判断");
      await expect(page.locator('[data-testid="pending-row"][data-kind="ai_relayed_human"]').first()).toBeVisible();
    });

    await test.step("確定のシート：会話の回答は判断の理由なしで受ける。件数は「n 行」、「| 確定」は右端で隠れない（docs/screens.md 3.2「会話の回答の受け方」）", async () => {
      await page.getByTestId("decisions-kind").locator("button").filter({ hasText: /^会話の回答/ }).first().click();
      await expect(page.getByTestId("decisions-sheet")).toHaveAttribute("data-kind", "relayed");
      // 判断の理由の欄と、押せない理由は出さない
      await expect(page.getByTestId("decisions-reason")).toHaveCount(0);
      await expect(page.getByTestId("decisions-bulk-reason")).toHaveCount(0);
      const rows = page.locator('[data-testid="pending-row"][data-kind="ai_relayed_human"][data-accepted="false"]');
      const n = await rows.count();
      expect(n).toBeGreaterThan(0);
      const bulk = page.getByTestId("decisions-bulk-accept");
      await expect(bulk).toHaveText(`会話の回答 ${n.toLocaleString("ja-JP")} 件を確定`);
      await expect(bulk).toBeEnabled();
      // 取り込みの質問の答えの件数は「n 行」。「—」「―」を並べない
      const counts = page.locator('[data-testid="pending-row"][data-decision-kind="reading"] [data-testid="pending-count"]');
      expect(await counts.count()).toBeGreaterThan(0);
      for (const t of await counts.allTextContents()) expect(t).toMatch(/^[\d,]+ 行$/);
      await expect(page.getByTestId("pending-count").filter({ hasText: /[—―]/ })).toHaveCount(0);
      // 理由は 1 行で切り、全文は title
      const why = rows.first().getByTestId("pending-why");
      expect(await why.getAttribute("title")).toBe(await why.textContent());
      expect(await why.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      // 行ごとの「| 確定」も理由なしで押せる。右端の列に固定され、ほかのものに隠れていない
      const accept = rows.first().getByTestId("pending-accept");
      await expect(accept).toBeEnabled();
      await accept.click({ trial: true });
      expect(await accept.evaluate((el) => getComputedStyle(el.closest("td")!).position)).toBe("sticky");
      const box = await accept.boundingBox();
      expect(box, "「| 確定」の位置").toBeTruthy();
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: shot(`decisions-conversation-${tag}`) });
      // 「| 会話の回答 n 件を確定」で、会話の回答をまとめて受ける
      await bulk.click();
      await expect(rows).toHaveCount(0);
    });

    await test.step("chart_rows：星取表の行を 1 回 200 行まで読み、会話の残りが減る", async () => {
      const r = await call(c, "chart_rows", { limit: 200 });
      expect(r.total).toBeGreaterThan(10);
      expect(r.rows.length).toBe(Math.min(200, r.total));
      // 取り込みの要約の見本の行も、会話の上限に数える（台帳の中-11）。だから残りは 2000 − この行より少ない
      expect(r.remainingInConversation).toBeLessThan(2000 - r.rows.length);
      expect(r.rows.some((x: any) => Object.values(x.cells).includes("●"))).toBe(true);
      const r2 = await call(c, "chart_rows", { offset: 0, limit: 5 });
      expect(r2.remainingInConversation).toBe(r.remainingInConversation - 5);
    });

    await test.step("画面の星取表にも、AI が作った計画の行が出る", async () => {
      await page.getByTestId("sheet-chart").click();
      await expect(page.getByTestId("plan-name")).toHaveText("【架空】第一清掃工場（AI）");
      await expect(page.locator(".ag-row").first()).toBeVisible();
      await page.screenshot({ path: shot(`mcp-chart-${tag}`) });
    });

    await test.step("screen_set の答えに、見せ方を覚えた施設の名前と作業中の計画の版（chart_rows の version と同じ。仕事 chat-prompts-v1）", async () => {
      const rows = await call(c, "chart_rows", { limit: 1 });
      const set = await call(c, "screen_set", { levelOrder: "asset-first" });
      expect(set.current.facility).toBe("【架空】第一清掃工場（AI）");
      expect(set.current.planVersion).toBe(rows.version);
    });
  } finally {
    await c.close();
  }
});

// 想定のプロンプトの試験（docs/progress/prompt-test-2026-11-07.md）の小さな穴（仕事 chat-prompts-v1）。計画を作る前の作業画面で確かめる
test("「画面を出して」の開いた印・screen_set の施設の名前・「デモして」は人が落とした資料の横に入れない", async ({ page }) => {
  test.setTimeout(60_000);
  const c = await mcpClient(bridge.stateDir);
  try {
    await test.step("人が資料を画面に落とす（Skillパックのデモと同じ架空の資料でも、人が入れたものは利用者の資料）", async () => {
      await openIntakeAndDrop(page, bridge.base, "【架空】第二清掃工場（混ざり）");
    });

    await test.step("「画面を出して」：show: true の答えに開いた印（試験の橋渡しは開く手を持たないので opened は false、タブはつながっている）", async () => {
      const s = await call(c, "intake_survey", { show: true, part: "compose" });
      expect(s.screen).toEqual({ opened: false, connected: true });
      expect(s.note).toBeUndefined();
    });

    await test.step("screen_set の答えに、見せ方を覚えた施設の名前。計画が無いので版は null", async () => {
      const set = await call(c, "screen_set", { levelOrder: "asset-first" });
      expect(set.current.facility).toBe("【架空】第二清掃工場（混ざり）");
      expect(set.current.planVersion).toBeNull();
    });

    await test.step("「デモして」：人が落とした資料の横に、デモの資料を入れない（どれも mixed、note に次の手）", async () => {
      const d = await call(c, "intake_add_files", { source: "demo" });
      expect(d.added).toEqual([]);
      expect(d.refused.map((x: { reason: string }) => x.reason)).toEqual(["mixed", "mixed", "mixed"]);
      expect(d.note).toContain("利用者の資料と架空の資料を混ぜない");
      // 資料の選びの数は、人が落とした 3 つのまま
      await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "3");
    });
  } finally {
    await c.close();
  }
});
