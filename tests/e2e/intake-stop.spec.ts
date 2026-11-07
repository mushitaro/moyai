// 下の帯の止まった知らせ（docs/screens.md 3.3「止まった知らせ」、Wire、11-07）を、この PC の Chrome と Edge で起こして写す（仕事 intake-screen-v4）。
// - 結果不明：AI のツール（intake_settle）を本物の中継（dist/cli.js mcp）から呼び、作業画面の答え（tab.tool_result）をページの中で 1 回だけ捨てる。
//   本物の橋渡しが、案を置くツールの時間の上限（TOOL_TIMEOUTS.propose）まで待って AI に誤りを返し、作業画面に bridge.tool_unknown を送る。
//   橋渡しの時間の上限は変えない。捨てるのはこの試験のページの中だけ（addInitScript で WebSocket の send を包む）。
// - 取り込み停止：取り込みの worker を、ページの中で terminate する（addInitScript で Worker を包み、作った worker を試験が持つ）。
//   画面は、worker が持っていた見張りの lock（src/app/intake/alive.ts）が離れたことで止まったと知る。本番の画面に試験の口は足さない。
// 写しは shot() の intake-stop-unknown-<ブラウザ>・intake-stop-worker-<ブラウザ>。先に npm run build を走らせておく。
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { callTool, mcpClient, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

/**
 * 案を置くツールを橋渡しが作業画面に待つ上限（src/shared/tools.ts の TOOL_TIMEOUTS.propose.ms）。
 * Playwright の読み手は src/shared/tools.ts が読む JSON を import できないので、字から読む（数を写さない）
 */
const PROPOSE_MS = (() => {
  const m = /propose:\s*\{\s*ms:\s*([\d_]+)/.exec(readFileSync("src/shared/tools.ts", "utf8"));
  if (!m) throw new Error("src/shared/tools.ts に TOOL_TIMEOUTS.propose が見つからない");
  return Number(m[1]!.replace(/_/g, ""));
})();

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-intake-stop-");
});
test.afterAll(() => bridge?.stop());

/** ページの中の差し替え（この試験のページだけ。アプリのコードには足さない）。ページのスクリプトより先に動く */
async function installPageHooks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eDropToolResults?: number; __e2eWorkers?: { name: string; worker: Worker }[] };
    // 作業画面 → 橋渡しの tab.tool_result を、数えた分だけ捨てる（橋渡しはタブの答えを時間の上限まで待つ）
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
      if ((w.__e2eDropToolResults ?? 0) > 0 && typeof data === "string" && data.startsWith('{"type":"tab.tool_result"')) {
        w.__e2eDropToolResults = (w.__e2eDropToolResults ?? 0) - 1;
        return;
      }
      return send.call(this, data);
    };
    // 作った worker を持っておく（試験が terminate する）
    const Base = window.Worker;
    const made: { name: string; worker: Worker }[] = [];
    w.__e2eWorkers = made;
    class Kept extends Base {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        made.push({ name: options?.name ?? "", worker: this });
      }
    }
    window.Worker = Kept;
  });
}

test("結果不明：作業画面の答えが橋渡しに届かず時間切れになると、下の帯の左に「結果不明 1」。押すと詳細に記録", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(PROPOSE_MS + 120_000);
  await installPageHooks(page);
  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle"]);
  try {
    await test.step("資料を落とす。止まった知らせはまだ無い", async () => {
      await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場（結果不明）");
      await expect(page.getByTestId("stop-unknown")).toHaveCount(0);
      await expect(page.getByTestId("stop-worker")).toHaveCount(0);
    });

    await test.step("AI の intake_settle の答えを作業画面で 1 回捨てる：橋渡しは時間の上限まで待ち、AI に誤りを返す", async () => {
      const s = await callTool(c, "intake_survey", { part: "questions" });
      const q = s.questions.find((x: any) => x.valueKind === "option" && x.defaultAnswer !== null) ?? s.questions.find((x: any) => x.valueKind === "option");
      expect(q, "選択肢の質問がある").toBeTruthy();
      await page.evaluate(() => {
        (window as unknown as { __e2eDropToolResults: number }).__e2eDropToolResults = 1;
      });
      const t0 = Date.now();
      const r: any = await c.callTool(
        { name: "intake_settle", arguments: { decisions: [{ questionId: q.questionId, answer: q.defaultAnswer ?? q.options[0].id, author: "ai", reason: "試験：作業画面の答えを捨てる" }] } },
        undefined,
        { timeout: PROPOSE_MS + 60_000 },
      );
      expect(r.isError).toBe(true);
      // 橋渡しの時間の上限（変えていない）まで待った
      expect(Date.now() - t0).toBeGreaterThanOrEqual(PROPOSE_MS - 1_000);
      // 捨てたのは 1 回だけ
      expect(await page.evaluate(() => (window as unknown as { __e2eDropToolResults: number }).__e2eDropToolResults)).toBe(0);
    });

    await test.step("下の帯の左に朱の字「結果不明 1」。押すと横の板の詳細に記録（処理・日時・停止箇所）", async () => {
      const b = page.locator(".moyai-merge-bar").getByTestId("stop-unknown");
      await expect(b).toHaveText("結果不明 1");
      await expect(b).toHaveClass(/moyai-stop-notice/);
      await expect(page.getByTestId("stop-worker")).toHaveCount(0);
      await b.click();
      const d = page.getByTestId("stop-detail");
      await expect(d).toBeVisible();
      await expect(d).toHaveAttribute("data-kind", "unknown");
      await expect(d.getByTestId("stop-record")).toHaveCount(1);
      await expect(d).toContainText("処理　intake_settle");
      await expect(d).toContainText(/日時　\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
      await expect(d).toContainText("停止箇所　作業画面（時間切れ）");
      await expect(d).not.toContainText("やり直す");
      await page.screenshot({ path: shot(`intake-stop-unknown-${tag}`), fullPage: true });
    });
  } finally {
    await c.close();
  }
});

test("取り込み停止：取り込みの worker が止まると、下の帯の左に「取り込み停止」。押すと詳細に記録", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(120_000);
  await installPageHooks(page);

  await test.step("資料を落とす。取り込みは worker の中で動いている（同じスレッドへ落ちていない）", async () => {
    await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場（取り込み停止）");
    await expect(page.getByTestId("stop-worker")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __e2eWorkers: { name: string }[] }).__e2eWorkers.filter((x) => x.name === "moyai-intake").length)).toBe(1);
  });

  await test.step("worker を terminate すると、「取り込み停止」。押すと横の板の詳細に記録（処理・日時・停止箇所）", async () => {
    await page.evaluate(() => {
      for (const x of (window as unknown as { __e2eWorkers: { name: string; worker: Worker }[] }).__e2eWorkers) if (x.name === "moyai-intake") x.worker.terminate();
    });
    const b = page.locator(".moyai-merge-bar").getByTestId("stop-worker");
    await expect(b).toHaveText("取り込み停止");
    await expect(b).toHaveClass(/moyai-stop-notice/);
    await expect(page.getByTestId("stop-unknown")).toHaveCount(0);
    await b.click();
    const d = page.getByTestId("stop-detail");
    await expect(d).toBeVisible();
    await expect(d).toHaveAttribute("data-kind", "stopped");
    await expect(d.getByTestId("stop-record")).toHaveCount(1);
    await expect(d).toContainText("処理　取り込み処理");
    await expect(d).toContainText(/日時　\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await expect(d).toContainText("停止箇所　取り込み処理（応答なし）");
    await expect(d).toContainText("取り込みの処理が停止。このタブを読み込み直してください。");
    await page.screenshot({ path: shot(`intake-stop-worker-${tag}`), fullPage: true });
  });
});
