// 端から端まで：ビルドした橋渡し（dist/cli.js start）と、この PC の Chrome・Edge の作業画面のタブと、
// 本物の中継（dist/cli.js mcp。標準入出力の MCP）を、MCP のクライアントでつなぐ。
// 人が資料を画面に落とし、AI が intake_survey → intake_settle → intake_compose → intake_survey → chart_rows を呼ぶ。
// 先に npm run build を走らせておく。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";
import { openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-mcp-");
});
test.afterAll(() => bridge?.stop());

async function mcpClient(stateDir: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "mcp"],
    env: { ...(process.env as Record<string, string>), MOYAI_STATE_DIR: stateDir },
    stderr: "pipe",
  });
  const client = new Client({ name: "moyai-e2e", version: "0" });
  await client.connect(transport);
  // 本物のクライアントと同じく、ツールの一覧（出力の型）を先に読む。以後の結果は SDK が出力の型で確かめる
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["intake_survey", "intake_settle", "intake_compose", "chart_rows"]));
  return client;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r: any = await c.callTool({ name, arguments: args });
  expect(r.isError, `${name}: ${JSON.stringify(r.content)}`).toBeFalsy();
  expect(r.structuredContent, name).toBeTruthy();
  return r.structuredContent;
}

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

    await test.step("人が資料を画面に落とす", async () => {
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
      // 画面にも AI の作業と決定が出る（作者は AI（チャットでの人の答え））
      await expect(page.getByTestId("ai-activity").first()).toBeVisible();
      await expect(page.getByTestId("question")).toHaveCount(0);
      const authors = await page.getByTestId("decision").evaluateAll((els) => els.map((e) => e.getAttribute("data-author")));
      expect(new Set(authors)).toEqual(new Set(["ai_relayed_human"]));
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
      await expect(page.getByTestId("composed")).toContainText("AI が作りました");
      await page.screenshot({ path: shot(`mcp-composed-${tag}`), fullPage: true });
    });

    await test.step("chart_rows：星取表の行を 1 回 200 行まで読み、会話の残りが減る", async () => {
      const r = await call(c, "chart_rows", { limit: 200 });
      expect(r.total).toBeGreaterThan(10);
      expect(r.rows.length).toBe(Math.min(200, r.total));
      expect(r.remainingInConversation).toBe(2000 - r.rows.length);
      expect(r.rows.some((x: any) => Object.values(x.cells).includes("●"))).toBe(true);
      const r2 = await call(c, "chart_rows", { offset: 0, limit: 5 });
      expect(r2.remainingInConversation).toBe(2000 - r.rows.length - 5);
    });

    await test.step("画面の星取表にも、AI が作った計画の行が出る", async () => {
      await page.getByTestId("to-chart").click();
      await expect(page.getByTestId("plan-name")).toHaveText("【架空】第一清掃工場（AI）");
      await expect(page.locator(".ag-row").first()).toBeVisible();
      await page.screenshot({ path: shot(`mcp-chart-${tag}`) });
    });
  } finally {
    await c.close();
  }
});
